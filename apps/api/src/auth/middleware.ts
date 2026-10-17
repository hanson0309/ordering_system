import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { eq, and } from 'drizzle-orm'
import { createDb } from '../db/client'
import { branches, sessions, users, memberships, tenants } from '../db/schema'
import { hashSessionToken, SESSION_COOKIE_NAME } from './session'
import type { Env, AppVariables } from '../types'

/**
 * Verifies the session cookie and loads the authenticated user.
 * Must run before requireTenant. Never reads tenant identity from the
 * request itself — only from the verified session row in the DB.
 */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME)
    if (!token) {
      return c.json({ error: 'unauthenticated' }, 401)
    }

    const db = createDb(c.env)
    const tokenHash = await hashSessionToken(token)

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1)

    if (!session || session.expiresAt.getTime() < Date.now()) {
      return c.json({ error: 'unauthenticated' }, 401)
    }

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
    if (!user) {
      return c.json({ error: 'unauthenticated' }, 401)
    }

    c.set('auth', {
      userId: user.id,
      isPlatformAdmin: user.isPlatformAdmin,
      activeTenantId: session.activeTenantId,
    })

    await next()
  },
)

/**
 * Requires an authenticated session with an active, currently-valid
 * membership in a tenant. The tenant is taken ONLY from the server-verified
 * session context (set during login / explicit org switch, both of which
 * check membership first) — never from a header, query string, or body.
 *
 * Re-checks membership on every request (not just at switch time) so a
 * revoked membership takes effect immediately rather than at next login.
 */
export const requireTenant = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const auth = c.get('auth')
    if (!auth.activeTenantId) {
      return c.json({ error: 'no_active_organization' }, 403)
    }

    const db = createDb(c.env)
    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.userId, auth.userId), eq(memberships.tenantId, auth.activeTenantId)),
      )
      .limit(1)

    if (!membership) {
      return c.json({ error: 'forbidden' }, 403)
    }

    c.set('tenant', { tenantId: membership.tenantId, role: membership.role })

    await next()
  },
)

const ROLE_RANK = { viewer: 0, staff: 1, admin: 2, owner: 3 } as const

/** Requires the current tenant membership role to be at least `minRole`. */
export function requireRole(minRole: keyof typeof ROLE_RANK) {
  return createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
    const tenant = c.get('tenant')
    if (ROLE_RANK[tenant.role] < ROLE_RANK[minRole]) {
      return c.json({ error: 'insufficient_role' }, 403)
    }
    await next()
  })
}

/** Requires the explicit platform-level cross-tenant permission. */
export const requirePlatformAdmin = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const auth = c.get('auth')
    if (!auth.isPlatformAdmin) {
      return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  },
)

/**
 * Resolves the tenant for an unauthenticated public storefront request from
 * the `:slug` URL param. There is no session/membership involved here — the
 * only "identity" is the slug itself, so a suspended or unknown slug must
 * look identical to the client (generic 404), never revealing which case it is.
 */
export const resolvePublicTenant = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const slug = c.req.param('slug')
    if (!slug) {
      return c.json({ error: 'not_found' }, 404)
    }
    const db = createDb(c.env)

    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)

    if (!tenant || tenant.status !== 'active') {
      return c.json({ error: 'not_found' }, 404)
    }

    c.set('publicTenant', { id: tenant.id, slug: tenant.slug, name: tenant.name })

    const locationSlug = c.req.param('locationSlug')
    const branchRows = await db
      .select({ id: branches.id, slug: branches.slug, name: branches.name, isDefault: branches.isDefault })
      .from(branches)
      .where(eq(branches.tenantId, tenant.id))
    if (locationSlug) {
      const branch = branchRows.find((row) => row.slug === locationSlug)
      if (!branch || !branch.slug) return c.json({ error: 'not_found' }, 404)
      c.set('publicBranch', { id: branch.id, slug: branch.slug, name: branch.name })
    } else {
      const defaultBranch = branchRows.find((row) => row.isDefault && row.slug)
      c.set('publicBranch', defaultBranch?.slug ? { id: defaultBranch.id, slug: defaultBranch.slug, name: defaultBranch.name } : null)
    }

    await next()
  },
)
