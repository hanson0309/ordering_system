import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, createTenant, createUser, addMembership, loginAndGetCookie, SELF } from './helpers'
import { memberships } from '../src/db/schema'

describe('dashboard user management', () => {
  it('allows an owner to create a user for the active organization', async () => {
    const tenant = await createTenant('User Store', 'user-management-owner')
    const owner = await createUser('user-management-owner@example.com')
    await addMembership(owner, tenant, 'owner')
    const cookie = await loginAndGetCookie('user-management-owner@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-staff@example.com', password: 'new-password-123', role: 'staff' }),
    })

    expect(response.status).toBe(201)
    const body = await response.json<{ user: { email: string; role: string }; membership: { tenantId: string } }>()
    expect(body.user).toMatchObject({ email: 'new-staff@example.com', role: 'staff' })
    expect(body.membership.tenantId).toBe(tenant)

    const newCookie = await loginAndGetCookie('new-staff@example.com', 'new-password-123')
    expect(newCookie).toContain('session=')
  })

  it('only allows owners to create dashboard users', async () => {
    const tenant = await createTenant('User Store', 'user-management-admin')
    const admin = await createUser('user-management-admin@example.com')
    await addMembership(admin, tenant, 'admin')
    const cookie = await loginAndGetCookie('user-management-admin@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'blocked@example.com', password: 'new-password-123', role: 'staff' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'insufficient_role' })
  })

  it('rejects duplicate emails and invalid account input', async () => {
    const tenant = await createTenant('User Store', 'user-management-validation')
    const owner = await createUser('user-management-validation@example.com')
    await addMembership(owner, tenant, 'owner')
    await createUser('existing@example.com')
    const cookie = await loginAndGetCookie('user-management-validation@example.com')

    const duplicate = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'existing@example.com', password: 'new-password-123', role: 'staff' }),
    })
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toEqual({ error: 'email_taken' })

    const invalid = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'short', role: 'owner' }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: 'invalid_input' })
  })

  it('lists only users who belong to the active organization', async () => {
    const tenant = await createTenant('User Store', 'user-management-list')
    const otherTenant = await createTenant('Other Store', 'user-management-list-other')
    const owner = await createUser('user-management-list-owner@example.com')
    const visible = await createUser('visible@example.com')
    const hidden = await createUser('hidden@example.com')
    await addMembership(owner, tenant, 'owner')
    await addMembership(visible, tenant, 'staff')
    await addMembership(hidden, otherTenant, 'staff')
    const cookie = await loginAndGetCookie('user-management-list-owner@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = await response.json<{ users: { email: string; role: string }[] }>()
    expect(body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'user-management-list-owner@example.com', role: 'owner' }),
      expect.objectContaining({ email: 'visible@example.com', role: 'staff' }),
    ]))
    expect(body.users.some((user) => user.email === 'hidden@example.com')).toBe(false)
    const membershipsInTenant = await db().select().from(memberships).where(eq(memberships.tenantId, tenant))
    expect(membershipsInTenant).toHaveLength(2)
    expect(hidden).toBeTruthy()
  })

  it('allows an owner to change another member role and reset their password', async () => {
    const tenant = await createTenant('User Store', 'user-management-edit')
    const owner = await createUser('user-management-edit-owner@example.com')
    const member = await createUser('user-management-edit-member@example.com', 'old-password-123')
    await addMembership(owner, tenant, 'owner')
    await addMembership(member, tenant, 'staff')
    const cookie = await loginAndGetCookie('user-management-edit-owner@example.com')
    const memberCookie = await loginAndGetCookie('user-management-edit-member@example.com', 'old-password-123')

    const update = await SELF.fetch(`https://test.local/api/dashboard/users/${member}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', password: 'new-password-123' }),
    })

    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({ user: { id: member, role: 'admin' } })
    const oldSessionRequest = await SELF.fetch('https://test.local/api/dashboard/orders', { headers: { cookie: memberCookie } })
    expect(oldSessionRequest.status).toBe(401)
    const oldLogin = await SELF.fetch('https://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user-management-edit-member@example.com', password: 'old-password-123' }),
    })
    expect(oldLogin.status).toBe(401)
    const newCookie = await loginAndGetCookie('user-management-edit-member@example.com', 'new-password-123')
    expect(newCookie).toContain('session=')
  })

  it('does not allow an owner to edit their own role or password', async () => {
    const tenant = await createTenant('User Store', 'user-management-self')
    const owner = await createUser('user-management-self-owner@example.com', 'owner-password-123')
    await addMembership(owner, tenant, 'owner')
    const cookie = await loginAndGetCookie('user-management-self-owner@example.com', 'owner-password-123')

    const update = await SELF.fetch(`https://test.local/api/dashboard/users/${owner}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'staff', password: 'changed-password-123' }),
    })

    expect(update.status).toBe(403)
    await expect(update.json()).resolves.toEqual({ error: 'cannot_edit_self' })
    expect((await loginAndGetCookie('user-management-self-owner@example.com', 'owner-password-123'))).toContain('session=')
  })

  it('rejects account edits from non-owners and rejects owner role assignment', async () => {
    const tenant = await createTenant('User Store', 'user-management-edit-permissions')
    const admin = await createUser('user-management-edit-admin@example.com')
    const member = await createUser('user-management-edit-target@example.com')
    await addMembership(admin, tenant, 'admin')
    await addMembership(member, tenant, 'staff')
    const adminCookie = await loginAndGetCookie('user-management-edit-admin@example.com')

    const forbidden = await SELF.fetch(`https://test.local/api/dashboard/users/${member}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toEqual({ error: 'insufficient_role' })

    const owner = await createUser('user-management-edit-permissions-owner@example.com')
    await addMembership(owner, tenant, 'owner')
    const ownerCookie = await loginAndGetCookie('user-management-edit-permissions-owner@example.com')
    const invalidRole = await SELF.fetch(`https://test.local/api/dashboard/users/${member}`, {
      method: 'PATCH',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(invalidRole.status).toBe(400)
    await expect(invalidRole.json()).resolves.toEqual({ error: 'invalid_input' })
  })
})
