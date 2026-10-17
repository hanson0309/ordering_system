import { describe, it, expect } from 'vitest'
import {
  SELF,
  createTenant,
  createUser,
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
