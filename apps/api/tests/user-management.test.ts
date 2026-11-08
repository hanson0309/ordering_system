import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, createTenant, createUser, addMembership, grantPlatformAdmin, loginAndGetCookie, SELF } from './helpers'
import { memberships } from '../src/db/schema'

describe('dashboard user management', () => {
  it('logs in with a normalized username', async () => {
    const tenant = await createTenant('Username login', 'username-login')
    const userId = await createUser('store_admin@example.com')
    await addMembership(userId, tenant, 'admin')

    const response = await SELF.fetch('https://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ' Store_Admin ', password: 'password123' }),
    })

    expect(response.status).toBe(200)
  })

  it('lets a platform administrator provision an account with a separate tenant', async () => {
    const tenant = await createTenant('Primary Store', 'user-management-primary')
    const administrator = await createUser('user-management-platform-admin@example.com')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    const cookie = await loginAndGetCookie('user-management-platform-admin@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'new-staff', password: 'new-password-123', role: 'staff' }),
    })

    expect(response.status).toBe(201)
    const body = await response.json<{ user: { username: string; role: string }; membership: { tenantId: string }; organization: { tenantId: string } }>()
    expect(body.user).toMatchObject({ username: 'new-staff', role: 'staff' })
    expect(body.user).not.toHaveProperty('email')
    expect(body.membership.tenantId).toBe(body.organization.tenantId)
    expect(body.membership.tenantId).not.toBe(tenant)
    const accountMemberships = await db().select().from(memberships).where(eq(memberships.userId, body.user.id))
    expect(accountMemberships).toHaveLength(1)
    expect(accountMemberships[0].tenantId).toBe(body.organization.tenantId)

    const newCookie = await loginAndGetCookie('new-staff@example.com', 'new-password-123')
    expect(newCookie).toContain('session=')
  })

  it('rejects account creation by ordinary tenant owners', async () => {
    const tenant = await createTenant('User Store', 'user-management-admin')
    const admin = await createUser('user-management-admin@example.com')
    await addMembership(admin, tenant, 'admin')
    const cookie = await loginAndGetCookie('user-management-admin@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'blocked-user', password: 'new-password-123', role: 'staff' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('rejects duplicate usernames and invalid account input', async () => {
    const tenant = await createTenant('User Store', 'user-management-validation')
    const administrator = await createUser('user-management-validation@example.com')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    await createUser('existing@example.com')
    const cookie = await loginAndGetCookie('user-management-validation@example.com')

    const duplicate = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'EXISTING', password: 'new-password-123', role: 'staff' }),
    })
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toEqual({ error: 'username_taken' })

    const invalid = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'not valid!', password: 'short', role: 'owner' }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: 'invalid_input' })
  })

  it('lets a platform administrator list ordinary accounts across tenants', async () => {
    const tenant = await createTenant('Primary Store', 'user-management-list-primary')
    const otherTenant = await createTenant('Other Store', 'user-management-list-other')
    const administrator = await createUser('user-management-list-admin@example.com')
    const firstAccount = await createUser('first-account@example.com')
    const secondAccount = await createUser('second-account@example.com')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    await addMembership(firstAccount, tenant, 'staff')
    await addMembership(secondAccount, otherTenant, 'staff')
    const cookie = await loginAndGetCookie('user-management-list-admin@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/users', { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = await response.json<{ users: { username: string; role: string }[] }>()
    expect(body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: 'first-account', role: 'staff', tenantId: tenant }),
      expect.objectContaining({ username: 'second-account', role: 'staff', tenantId: otherTenant }),
    ]))
    expect(body.users.some((user) => user.username === 'user-management-list-admin')).toBe(false)
    expect(body.users.every((user) => !('email' in user))).toBe(true)
  })

  it('lets a platform administrator change an ordinary account role and reset its password', async () => {
    const tenant = await createTenant('User Store', 'user-management-edit')
    const administrator = await createUser('user-management-edit-platform@example.com')
    const member = await createUser('user-management-edit-member@example.com', 'old-password-123')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    await addMembership(member, tenant, 'staff')
    const cookie = await loginAndGetCookie('user-management-edit-platform@example.com')
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
      body: JSON.stringify({ username: 'user-management-edit-member', password: 'old-password-123' }),
    })
    expect(oldLogin.status).toBe(401)
    const newCookie = await loginAndGetCookie('user-management-edit-member@example.com', 'new-password-123')
    expect(newCookie).toContain('session=')
  })

  it('does not allow a platform administrator to edit their own role or password', async () => {
    const tenant = await createTenant('User Store', 'user-management-self')
    const administrator = await createUser('user-management-self-admin@example.com', 'owner-password-123')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    const cookie = await loginAndGetCookie('user-management-self-admin@example.com', 'owner-password-123')

    const update = await SELF.fetch(`https://test.local/api/dashboard/users/${administrator}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'staff', password: 'changed-password-123' }),
    })

    expect(update.status).toBe(403)
    await expect(update.json()).resolves.toEqual({ error: 'cannot_edit_self' })
    expect((await loginAndGetCookie('user-management-self-admin@example.com', 'owner-password-123'))).toContain('session=')
  })

  it('rejects account edits by non-admins and owner role assignment', async () => {
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
    await expect(forbidden.json()).resolves.toEqual({ error: 'forbidden' })

    const administrator = await createUser('edit-permissions-platform@example.com')
    await grantPlatformAdmin(administrator)
    await addMembership(administrator, tenant, 'owner')
    const administratorCookie = await loginAndGetCookie('edit-permissions-platform@example.com')
    const invalidRole = await SELF.fetch(`https://test.local/api/dashboard/users/${member}`, {
      method: 'PATCH',
      headers: { cookie: administratorCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(invalidRole.status).toBe(400)
    await expect(invalidRole.json()).resolves.toEqual({ error: 'invalid_input' })
  })
})
