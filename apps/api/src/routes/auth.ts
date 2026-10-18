import { Hono, type Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { createDb } from '../db/client'
import { users, sessions, memberships, tenants } from '../db/schema'
import { verifyPassword } from '../auth/password'
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '../auth/session'
import { newId } from '../lib/id'
import { requireAuth } from '../auth/middleware'
import type { Env, AppVariables } from '../types'

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(256),
})

async function createSessionCookie(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  env: Env,
  userId: string,
  activeTenantId: string | null,
) {
  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)
  const db = createDb(env)
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await db.insert(sessions).values({
    id: newId('sess'),
    tokenHash,
    userId,
    activeTenantId,
    expiresAt,
  })

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.ENVIRONMENT === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

authRoutes.post('/register', async (c) => {
  // Accounts are provisioned by an administrator. Keeping this denial on the
  // server ensures the public API cannot be used to create arbitrary users.
  return c.json({ error: 'registration_disabled' }, 403)
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = credentialsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  const { email, password } = parsed.data

  const db = createDb(c.env)
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  // Always run password verification, even for a nonexistent user, against a
  // fixed dummy hash — avoids a timing side-channel that reveals which
  // emails are registered.
  const DUMMY_HASH = 'pbkdf2:100000:00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000'
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok) {
    return c.json({ error: 'invalid_credentials' }, 401)
  }

  // Pick an arbitrary membership (if any) as the default active tenant.
  // The user still must explicitly switch to access a different org, and
  // every subsequent request re-validates this membership server-side.
  const [firstMembership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1)

  await createSessionCookie(c, c.env, user.id, firstMembership?.tenantId ?? null)

  return c.json({ userId: user.id })
})

authRoutes.post('/logout', requireAuth, async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (token) {
    const db = createDb(c.env)
    await db.delete(sessions).where(eq(sessions.tokenHash, await hashSessionToken(token)))
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  return c.json({ ok: true })
})

/**
 * Switch the active tenant for the current session. Requires an explicit,
 * currently-valid membership in the target tenant — switching never
 * succeeds just because the user has *some* account.
 */
authRoutes.post('/switch-organization', requireAuth, async (c) => {
  const schema = z.object({ tenantId: z.string().min(1) })
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'invalid_input' }, 400)
  }

  const auth = c.get('auth')
  const db = createDb(c.env)
  if (auth.isPlatformAdmin) {
    const [tenant] = await db
      .select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, parsed.data.tenantId))
      .limit(1)
    if (!tenant || tenant.status !== 'active') {
      return c.json({ error: 'forbidden' }, 403)
    }
    await createSessionCookie(c, c.env, auth.userId, tenant.id)
    return c.json({ tenantId: tenant.id, role: 'owner' })
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, auth.userId), eq(memberships.tenantId, parsed.data.tenantId)))
    .limit(1)

  if (!membership) {
    return c.json({ error: 'forbidden' }, 403)
  }

  await createSessionCookie(c, c.env, auth.userId, membership.tenantId)
  return c.json({ tenantId: membership.tenantId, role: membership.role })
})
