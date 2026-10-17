import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../db/client'
import { memberships, tenants } from '../db/schema'
import { requireAuth } from '../auth/middleware'
import type { Env, AppVariables } from '../types'

export const membershipRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

// Lists only the organizations this user explicitly belongs to — never a
// full tenant list. Used by the UI to render the organization switcher.
membershipRoutes.get('/me/organizations', requireAuth, async (c) => {
  const auth = c.get('auth')
  const db = createDb(c.env)

  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, auth.userId))

  return c.json({ organizations: rows, activeTenantId: auth.activeTenantId })
})
