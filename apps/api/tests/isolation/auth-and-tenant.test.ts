import { describe, it, expect } from 'vitest'
import {
  SELF,
  createTenant,
  createUser,
  grantPlatformAdmin,
  addMembership,
  loginAndGetCookie,
  switchOrganization,
} from '../helpers'

/**
 * NE/UPM isolation suite. These exercise the real HTTP routes end-to-end
 * (not internal functions) so they verify what an attacker could actually
 * observe, per the "default-deny, verify backend responses" requirement.
 */
describe('tenant isolation', () => {
  it('does not allow self-service registration', async () => {
    const res = await SELF.fetch('https://test.local/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-user@example.com', password: 'password123' }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'registration_disabled' })
  })

  it('a user without membership in a tenant cannot switch into it', async () => {
    const ne = await createTenant('NE', 'ne')
    const outsider = await createUser('outsider@example.com')
    // No membership created for `outsider` in `ne`.

    const cookie = await loginAndGetCookie('outsider@example.com')
    const { res } = await switchOrganization(cookie, ne)

    expect(res.status).toBe(403)
  })

  it('login does not grant an active tenant when the user has no memberships', async () => {
    await createUser('solo@example.com')
    const cookie = await loginAndGetCookie('solo@example.com')

    const res = await SELF.fetch('https://test.local/api/me/organizations', {
      headers: { cookie },
    })
    const body = await res.json<{ organizations: unknown[]; activeTenantId: string | null }>()

    expect(body.activeTenantId).toBeNull()
  })

  it('a user belonging to both NE and UPM only accesses each through an explicit switch', async () => {
    const ne = await createTenant('NE', 'ne-dual')
    const upm = await createTenant('UPM', 'upm-dual')
    const userId = await createUser('dual@example.com')
    await addMembership(userId, ne, 'owner')
    await addMembership(userId, upm, 'owner')

    const cookie = await loginAndGetCookie('dual@example.com')

    const orgsRes = await SELF.fetch('https://test.local/api/me/organizations', { headers: { cookie } })
    const orgs = await orgsRes.json<{ organizations: { tenantId: string }[] }>()
    expect(orgs.organizations.map((o) => o.tenantId).sort()).toEqual([ne, upm].sort())

    // Logging in picks *some* membership as active, but switching to the
    // other tenant must still require (and re-check) explicit membership.
    const { res: switchToUpm } = await switchOrganization(cookie, upm)
    expect(switchToUpm.status).toBe(200)
    const { res: switchToNe } = await switchOrganization(cookie, ne)
    expect(switchToNe.status).toBe(200)
  })

  it('lets only the platform administrator list and switch to every active account tenant', async () => {
    const primaryTenant = await createTenant('Primary Account', 'platform-primary')
    const otherTenant = await createTenant('Other Account', 'platform-other')
    const adminId = await createUser('platform-admin@example.com')
    await addMembership(adminId, primaryTenant, 'owner')
    await grantPlatformAdmin(adminId)
    const ordinaryId = await createUser('platform-ordinary@example.com')
    await addMembership(ordinaryId, otherTenant, 'owner')

    const adminCookie = await loginAndGetCookie('platform-admin@example.com')
    const orgsRes = await SELF.fetch('https://test.local/api/me/organizations', { headers: { cookie: adminCookie } })
    expect(orgsRes.status).toBe(200)
    const orgs = await orgsRes.json<{ organizations: { tenantId: string }[] }>()
    expect(orgs.organizations.map((organization) => organization.tenantId)).toEqual(
      expect.arrayContaining([primaryTenant, otherTenant]),
    )

    const { res: switchRes, cookie: selectedCookie } = await switchOrganization(adminCookie, otherTenant)
    expect(switchRes.status).toBe(200)
    const settingsRes = await SELF.fetch('https://test.local/api/dashboard/settings', { headers: { cookie: selectedCookie } })
    expect(settingsRes.status).toBe(200)
    await expect(settingsRes.json()).resolves.toMatchObject({ tenant: { name: 'Other Account' } })

    const ordinaryCookie = await loginAndGetCookie('platform-ordinary@example.com')
    const ordinaryOrgsRes = await SELF.fetch('https://test.local/api/me/organizations', { headers: { cookie: ordinaryCookie } })
    const ordinaryOrgs = await ordinaryOrgsRes.json<{ organizations: { tenantId: string }[] }>()
    expect(ordinaryOrgs.organizations.map((organization) => organization.tenantId)).toEqual([otherTenant])
    const { res: forbiddenSwitch } = await switchOrganization(ordinaryCookie, primaryTenant)
    expect(forbiddenSwitch.status).toBe(403)
  })

  it('creates each new dashboard account in its own empty tenant', async () => {
    const primaryTenant = await createTenant('Account Admin', 'account-admin-tenant')
    const adminId = await createUser('account-admin@example.com')
    await addMembership(adminId, primaryTenant, 'owner')
    await grantPlatformAdmin(adminId)
    const adminCookie = await loginAndGetCookie('account-admin@example.com')

    const firstRes = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'first-account', password: 'password123', role: 'admin' }),
    })
    expect(firstRes.status).toBe(201)
    const first = await firstRes.json<{ membership: { tenantId: string } }>()

    const secondRes = await SELF.fetch('https://test.local/api/dashboard/users', {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'second-account', password: 'password123', role: 'staff' }),
    })
    expect(secondRes.status).toBe(201)
    const second = await secondRes.json<{ membership: { tenantId: string } }>()

    expect(first.membership.tenantId).not.toBe(primaryTenant)
    expect(second.membership.tenantId).not.toBe(primaryTenant)
    expect(first.membership.tenantId).not.toBe(second.membership.tenantId)

    const firstCookie = await loginAndGetCookie('first-account@example.com')
    const firstOrgsRes = await SELF.fetch('https://test.local/api/me/organizations', { headers: { cookie: firstCookie } })
    const firstOrgs = await firstOrgsRes.json<{ organizations: { tenantId: string }[] }>()
    expect(firstOrgs.organizations.map((organization) => organization.tenantId)).toEqual([first.membership.tenantId])
  })

  it('rejects a tenant switch to an organization the session user never joined', async () => {
    const ne = await createTenant('NE', 'ne-reject')
    const upm = await createTenant('UPM', 'upm-reject')
    const neUser = await createUser('ne-user@example.com')
    await addMembership(neUser, ne, 'staff')

    const cookie = await loginAndGetCookie('ne-user@example.com')
    const { res } = await switchOrganization(cookie, upm)

    expect(res.status).toBe(403)
  })

  it('an unauthenticated request to a protected route is rejected', async () => {
    const res = await SELF.fetch('https://test.local/api/me/organizations')
    expect(res.status).toBe(401)
  })
})
