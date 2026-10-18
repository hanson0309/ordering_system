import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db/client'
import { tenants, users, memberships, customers, orders, categories, products, branches } from '../src/db/schema'
import { hashPassword } from '../src/auth/password'
import { newId } from '../src/lib/id'
import type { Env } from '../src/types'

export function db() {
  return createDb(env as unknown as Env)
}

export async function createTenant(name: string, slug: string, accountUserId?: string) {
  const id = newId('tenant')
  await db().insert(tenants).values({ id, accountUserId: accountUserId ?? null, name, slug })
  return id
}

export async function createUser(email: string, password = 'password123') {
  const id = newId('user')
  await db().insert(users).values({ id, email, passwordHash: await hashPassword(password) })
  return id
}

export async function grantPlatformAdmin(userId: string) {
  await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId))
}

export async function addMembership(
  userId: string,
  tenantId: string,
  role: 'owner' | 'admin' | 'staff' | 'viewer' = 'owner',
) {
  await db().insert(memberships).values({ id: newId('mem'), userId, tenantId, role })
}

export async function createCustomer(tenantId: string, name = 'Test Customer') {
  const id = newId('cust')
  await db().insert(customers).values({ id, tenantId, name, phone: '0123456789' })
  return id
}

export async function createCategory(tenantId: string, name = 'Test Category', sortOrder = 0) {
  const id = newId('cat')
  await db().insert(categories).values({ id, tenantId, name, sortOrder })
  return id
}

export async function createProduct(
  tenantId: string,
  overrides: Partial<{
    name: string
    priceSen: number
    isPublic: boolean
    isAvailable: boolean
    categoryId: string | null
  }> = {},
) {
  const id = newId('prod')
  await db()
    .insert(products)
    .values({
      id,
      tenantId,
      categoryId: overrides.categoryId ?? null,
      name: overrides.name ?? 'Test Product',
      priceSen: overrides.priceSen ?? 1000,
      isPublic: overrides.isPublic ?? true,
      isAvailable: overrides.isAvailable ?? true,
    })
  return id
}

export async function createBranch(tenantId: string, name: string, slug: string, isDefault = false) {
  const id = newId('branch')
  await db().insert(branches).values({ id, tenantId, name, slug, isDefault })
  return id
}

export async function createOrder(tenantId: string, customerId: string, orderNumber: string) {
  const id = newId('order')
  await db().insert(orders).values({
    id,
    tenantId,
    customerId,
    orderNumber,
    totalSen: 1000,
    idempotencyKey: newId('idem'),
  })
  return id
}

/** Logs in via the real HTTP route and returns the session cookie header value. */
export async function loginAndGetCookie(email: string, password = 'password123') {
  const res = await SELF.fetch('https://test.local/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('login did not set a cookie')
  return setCookie.split(';')[0]
}

export async function switchOrganization(cookie: string, tenantId: string) {
  const res = await SELF.fetch('https://test.local/api/auth/switch-organization', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ tenantId }),
  })
  const setCookie = res.headers.get('set-cookie')
  return { res, cookie: setCookie ? setCookie.split(';')[0] : cookie }
}

export async function getPublic(slug: string, path: string) {
  return SELF.fetch(`https://test.local/api/public/${slug}${path}`)
}

export async function postPublicOrder(slug: string, body: unknown) {
  return SELF.fetch(`https://test.local/api/public/${slug}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export { SELF, env }
