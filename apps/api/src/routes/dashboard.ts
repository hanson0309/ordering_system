import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth, requirePlatformAdmin, requireRole, requireTenant } from '../auth/middleware'
import { normalizeUsername } from '../auth/username'
import { hashPassword } from '../auth/password'
import { createDb } from '../db/client'
import {
  accountTelegramSettings,
  auditLogs,
  branches,
  categories,
  customers,
  memberships,
  notificationJobs,
  orderItems,
  orders,
  productImages,
  products,
  pricingRules,
  regions,
  scheduledMealPrices,
  sessions,
  tenantSettings,
  tenants,
  users,
} from '../db/schema'
import { newId } from '../lib/id'
import { scoped } from '../repositories/scoped'
import { loadOrderPdfFont, renderOrderPdf } from '../services/order-pdf'
import { sendOrderListNow, sendTelegramTestMessage, TelegramError } from '../services/notifications'
import { decryptSecret, encryptSecret } from '../services/secret-crypto'
import { isUploadFile, uploadErrorResponse, validateUpload } from '../services/uploads'
import { parseMalaysiaCutoff } from '../services/scheduled-meals'
import type { AppVariables, Env } from '../types'

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
type DashboardContext = Context<{ Bindings: Env; Variables: AppVariables }>

dashboardRoutes.use('*', requireAuth, requireTenant)

const orderStatuses = ['pending', 'confirmed', 'preparing', 'completed', 'cancelled'] as const
const statusSchema = z.object({ status: z.enum(orderStatuses) })

const allowedTransitions: Record<(typeof orderStatuses)[number], readonly string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

const createDashboardUserSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'staff', 'viewer']),
})

const updateDashboardUserSchema = z.object({
  role: z.enum(['admin', 'staff', 'viewer']).optional(),
  password: z.string().min(8).max(200).optional(),
}).refine((value) => value.role !== undefined || value.password !== undefined)

const pricingRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})
const branchPricingRuleSchema = z.object({ pricingRuleId: z.string().min(1).nullable() })

dashboardRoutes.get('/users', requirePlatformAdmin, async (c) => {
  const rows = await createDb(c.env)
    .select({
      id: users.id,
      username: users.username,
      role: memberships.role,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(users.isPlatformAdmin, false))
    .orderBy(asc(tenants.name), asc(users.username))
  const currentUserId = c.get('auth').userId
  return c.json({ users: rows.map((row) => ({ ...row, isCurrentUser: row.id === currentUserId })) })
})

dashboardRoutes.post('/users', requirePlatformAdmin, async (c) => {
  const parsed = createDashboardUserSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)

  const username = normalizeUsername(parsed.data.username)
  if (!username) return c.json({ error: 'invalid_input' }, 400)
  const email = `${username}@internal.invalid`
  const db = createDb(c.env)
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
  if (existing) return c.json({ error: 'username_taken' }, 409)

  const userId = newId('user')
  const membershipId = newId('mem')
  const tenantId = newId('tenant')
  const tenantSlug = `account-${userId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
  const tenantName = username
  const passwordHash = await hashPassword(parsed.data.password)
  try {
    await db.batch([
      db.insert(users).values({ id: userId, username, email, passwordHash }),
      db.insert(tenants).values({ id: tenantId, accountUserId: userId, name: tenantName, slug: tenantSlug, status: 'active' }),
      db.insert(memberships).values({ id: membershipId, userId, tenantId, role: parsed.data.role }),
      db.insert(tenantSettings).values({ tenantId, businessInfo: { design: 'clean' } }),
    ])
  } catch (err) {
    if (String(err).includes('users_username_unique')) return c.json({ error: 'username_taken' }, 409)
    if (String(err).includes('tenants_slug_unique')) return c.json({ error: 'slug_taken' }, 409)
    throw err
  }

  return c.json({
    user: { id: userId, username, role: parsed.data.role },
    membership: { id: membershipId, tenantId, role: parsed.data.role },
    organization: { tenantId, name: tenantName, slug: tenantSlug },
  }, 201)
})

dashboardRoutes.patch('/users/:userId', requirePlatformAdmin, async (c) => {
  const parsed = updateDashboardUserSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)

  const auth = c.get('auth')
  const userId = c.req.param('userId')
  if (userId === auth.userId) return c.json({ error: 'cannot_edit_self' }, 403)

  const db = createDb(c.env)
  const [target] = await db
    .select({ userId: memberships.userId, tenantId: memberships.tenantId, username: users.username, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(users.isPlatformAdmin, false)))
    .limit(1)
  if (!target) return c.json({ error: 'not_found' }, 404)

  const statements: any[] = []
  if (parsed.data.role !== undefined) {
    statements.push(db.update(memberships).set({ role: parsed.data.role }).where(and(eq(memberships.tenantId, target.tenantId), eq(memberships.userId, userId))))
  }
  if (parsed.data.password !== undefined) {
    statements.push(db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, userId)))
    statements.push(db.delete(sessions).where(eq(sessions.userId, userId)))
  }
  await db.batch(statements as [any, ...any[]])

  return c.json({
    user: { id: userId, username: target.username, role: parsed.data.role ?? target.role },
    updated: { role: parsed.data.role !== undefined, password: parsed.data.password !== undefined },
  })
})

const branchSchema = z.object({
  regionId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  address: z.string().trim().max(240).nullable().optional(),
  deliveryPeriod: z.enum(['lunch', 'dinner']).nullable().optional(),
  syncDefault: z.boolean().default(false),
  makeDefault: z.boolean().default(false),
})

const regionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

dashboardRoutes.get('/regions', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const rows = await createDb(c.env)
    .select({ id: regions.id, tenantId: regions.tenantId, name: regions.name, slug: regions.slug, isDefault: regions.isDefault })
    .from(regions)
    .where(eq(regions.tenantId, tenantId))
    .orderBy(desc(regions.isDefault), asc(regions.name))
  return c.json({ regions: rows })
})

dashboardRoutes.post('/regions', requireRole('admin'), async (c) => {
  const parsed = regionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const db = createDb(c.env)
  const [existing] = await db.select({ id: regions.id }).from(regions)
    .where(and(eq(regions.tenantId, tenantId), eq(regions.slug, parsed.data.slug))).limit(1)
  if (existing) return c.json({ error: 'slug_taken' }, 409)
  const region = { id: newId('region'), tenantId, name: parsed.data.name, slug: parsed.data.slug, isDefault: false }
  await db.insert(regions).values(region)
  return c.json({ region }, 201)
})

dashboardRoutes.get('/branches', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const regionId = c.req.query('regionId')
  if (regionId) {
    const [region] = await createDb(c.env).select({ id: regions.id }).from(regions)
      .where(and(eq(regions.id, regionId), eq(regions.tenantId, tenantId))).limit(1)
    if (!region) return c.json({ error: 'not_found' }, 404)
  }
  const rows = await createDb(c.env)
    .select({ id: branches.id, tenantId: branches.tenantId, regionId: branches.regionId, name: branches.name, slug: branches.slug, address: branches.address, isDefault: branches.isDefault, pricingRuleId: branches.pricingRuleId, deliveryPeriod: branches.deliveryPeriod, paymentQrKey: branches.paymentQrKey })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), regionId ? eq(branches.regionId, regionId) : undefined))
    .orderBy(desc(branches.isDefault), asc(branches.name))
  return c.json({ branches: rows.map(({ paymentQrKey, ...row }) => ({ ...row, hasPaymentQr: Boolean(paymentQrKey) })) })
})

dashboardRoutes.get('/pricing-rules', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const rows = await createDb(c.env)
    .select()
    .from(pricingRules)
    .where(eq(pricingRules.tenantId, tenantId))
    .orderBy(asc(pricingRules.sortOrder), asc(pricingRules.name))
  return c.json({ pricingRules: rows })
})

dashboardRoutes.post('/pricing-rules', requireRole('admin'), async (c) => {
  const parsed = pricingRuleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const rule = {
    id: newId('price-rule'),
    tenantId,
    name: parsed.data.name,
    isActive: parsed.data.isActive ?? true,
    sortOrder: parsed.data.sortOrder ?? 0,
  }
  try {
    await createDb(c.env).insert(pricingRules).values(rule)
  } catch {
    return c.json({ error: 'name_taken' }, 409)
  }
  return c.json({ pricingRule: rule }, 201)
})

dashboardRoutes.patch('/pricing-rules/:pricingRuleId', requireRole('admin'), async (c) => {
  const parsed = pricingRuleSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const result = await createDb(c.env)
    .update(pricingRules)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(pricingRules.id, c.req.param('pricingRuleId')), eq(pricingRules.tenantId, tenantId)))
  if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  return c.json({ pricingRuleId: c.req.param('pricingRuleId'), ...parsed.data })
})

dashboardRoutes.delete('/pricing-rules/:pricingRuleId', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const pricingRuleId = c.req.param('pricingRuleId')
  const db = createDb(c.env)
  const [branchReference, priceReference] = await Promise.all([
    db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.pricingRuleId, pricingRuleId))).limit(1),
    db.select({ id: scheduledMealPrices.id }).from(scheduledMealPrices).where(and(eq(scheduledMealPrices.tenantId, tenantId), eq(scheduledMealPrices.pricingRuleId, pricingRuleId))).limit(1),
  ])
  if (branchReference.length > 0 || priceReference.length > 0) return c.json({ error: 'pricing_rule_in_use' }, 409)
  const result = await db.delete(pricingRules).where(and(eq(pricingRules.id, pricingRuleId), eq(pricingRules.tenantId, tenantId)))
  if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  return c.json({ deleted: true })
})

dashboardRoutes.patch('/branches/:branchId/pricing-rule', requireRole('admin'), async (c) => {
  const parsed = branchPricingRuleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const db = createDb(c.env)
  if (parsed.data.pricingRuleId) {
    const [rule] = await db.select({ id: pricingRules.id }).from(pricingRules)
      .where(and(eq(pricingRules.id, parsed.data.pricingRuleId), eq(pricingRules.tenantId, tenantId))).limit(1)
    if (!rule) return c.json({ error: 'invalid_pricing_rule' }, 400)
  }
  const result = await db.update(branches).set({ pricingRuleId: parsed.data.pricingRuleId })
    .where(and(eq(branches.id, c.req.param('branchId')), eq(branches.tenantId, tenantId)))
  if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  return c.json({ branchId: c.req.param('branchId'), pricingRuleId: parsed.data.pricingRuleId })
})

dashboardRoutes.post('/branches', requireRole('admin'), async (c) => {
  const parsed = branchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const db = createDb(c.env)
  const [region] = await db.select({ id: regions.id }).from(regions).where(and(eq(regions.id, parsed.data.regionId), eq(regions.tenantId, tenantId))).limit(1)
  if (!region) return c.json({ error: 'not_found' }, 404)
  const [existingSlug] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.regionId, parsed.data.regionId), eq(branches.slug, parsed.data.slug))).limit(1)
  if (existingSlug) return c.json({ error: 'slug_taken' }, 409)
  const [existingDefault] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.regionId, parsed.data.regionId), eq(branches.isDefault, true))).limit(1)
  const branchId = newId('branch')
  const makeDefault = parsed.data.makeDefault || !existingDefault
  const statements: any[] = []
  if (makeDefault && existingDefault) statements.push(db.update(branches).set({ isDefault: false }).where(eq(branches.id, existingDefault.id)))
  statements.push(db.insert(branches).values({ id: branchId, tenantId, regionId: parsed.data.regionId, name: parsed.data.name, slug: parsed.data.slug, address: parsed.data.address ?? null, deliveryPeriod: parsed.data.deliveryPeriod ?? null, isDefault: makeDefault }))

  if (parsed.data.syncDefault) {
    const sourceBranchId = existingDefault?.id ?? null
    const sourceCategories = await db.select().from(categories).where(and(eq(categories.tenantId, tenantId), branchPredicate(categories, sourceBranchId)))
    const categoryMap = new Map<string, string>()
    for (const category of sourceCategories) categoryMap.set(category.id, newId('cat'))
    if (sourceCategories.length > 0) statements.push(db.insert(categories).values(sourceCategories.map((category) => ({ id: categoryMap.get(category.id)!, tenantId, branchId, name: category.name, sortOrder: category.sortOrder }))))
    const sourceProducts = await db.select().from(products).where(and(eq(products.tenantId, tenantId), branchPredicate(products, sourceBranchId)))
    if (sourceProducts.length > 0) statements.push(db.insert(products).values(sourceProducts.map((product) => ({ id: newId('prod'), tenantId, branchId, categoryId: product.categoryId ? categoryMap.get(product.categoryId) ?? null : null, name: product.name, imageUrl: product.imageUrl, priceSen: product.priceSen, isPublic: product.isPublic, isAvailable: product.isAvailable }))))
  }
  await db.batch(statements as [any, ...any[]])
  return c.json({ branch: { id: branchId, tenantId, regionId: parsed.data.regionId, name: parsed.data.name, slug: parsed.data.slug, address: parsed.data.address ?? null, deliveryPeriod: parsed.data.deliveryPeriod ?? null, isDefault: makeDefault }, syncedDefault: parsed.data.syncDefault }, 201)
})

dashboardRoutes.post('/branches/:branchId/default', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branchId = c.req.param('branchId')
  const [branch] = await createDb(c.env).select({ id: branches.id, regionId: branches.regionId }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId))).limit(1)
  if (!branch) return c.json({ error: 'not_found' }, 404)
  const db = createDb(c.env)
  await db.batch([
    db.update(branches).set({ isDefault: false }).where(eq(branches.regionId, branch.regionId)),
    db.update(branches).set({ isDefault: true }).where(eq(branches.id, branchId)),
  ])
  return c.json({ branchId, isDefault: true })
})

dashboardRoutes.post('/branches/:branchId/payment-qr', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branchId = c.req.param('branchId')
  const db = createDb(c.env)
  const [branch] = await db.select({ id: branches.id, paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId))).limit(1)
  if (!branch) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.parseBody()
  const file = body.file
  if (!isUploadFile(file)) return c.json({ error: 'invalid_file' }, 400)
  const validated = await validateUpload(file, 'qr')
  const uploadError = uploadErrorResponse(validated)
  if (uploadError) return c.json({ error: uploadError.error }, uploadError.status as 400 | 413)
  if (!validated || validated === 'too_large') return c.json({ error: 'invalid_file' }, 400)
  const key = `private/${tenantId}/branches/${branchId}/payment-qr.${validated.extension}`
  await c.env.DOCS_BUCKET.put(key, validated.bytes, { httpMetadata: { contentType: validated.contentType } })
  if (branch.paymentQrKey && branch.paymentQrKey !== key) await c.env.DOCS_BUCKET.delete(branch.paymentQrKey)
  await db.update(branches).set({ paymentQrKey: key }).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
  return c.json({ branchId, paymentQrUrl: `/api/dashboard/branches/${branchId}/payment-qr` })
})

dashboardRoutes.delete('/branches/:branchId/payment-qr', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branchId = c.req.param('branchId')
  const db = createDb(c.env)
  const [branch] = await db.select({ id: branches.id, paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId))).limit(1)
  if (!branch) return c.json({ error: 'not_found' }, 404)
  if (branch.paymentQrKey) await c.env.DOCS_BUCKET.delete(branch.paymentQrKey)
  await db.update(branches).set({ paymentQrKey: null }).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
  return c.json({ branchId, paymentQrUrl: null })
})

dashboardRoutes.get('/branches/:branchId/payment-qr', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branchId = c.req.param('branchId')
  const [branch] = await createDb(c.env).select({ paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId))).limit(1)
  if (!branch?.paymentQrKey) return c.json({ error: 'not_found' }, 404)
  const object = await c.env.DOCS_BUCKET.get(branch.paymentQrKey)
  if (!object) return c.json({ error: 'not_found' }, 404)
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'private, no-store' } })
})

function parsePagination(c: DashboardContext) {
  const rawLimit = Number(c.req.query('limit') ?? '25')
  const rawOffset = Number(c.req.query('offset') ?? '0')
  return {
    limit: Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25,
    offset: Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0,
  }
}

function parseOptionalStatus(value: string | undefined) {
  if (!value) return undefined
  return orderStatuses.includes(value as (typeof orderStatuses)[number])
    ? (value as (typeof orderStatuses)[number])
    : null
}

async function resolveBranch(c: DashboardContext): Promise<{ id: string; tenantId: string; name: string; slug: string | null; address: string | null; isDefault: boolean } | null | false> {
  const branchId = c.req.query('branchId')
  if (!branchId) return null
  const tenantId = c.get('tenant').tenantId
  const [branch] = await createDb(c.env)
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
    .limit(1)
  return branch ?? false
}

async function resolveRegion(c: DashboardContext): Promise<{ id: string } | null | false> {
  const regionId = c.req.query('regionId')
  if (!regionId) return null
  const tenantId = c.get('tenant').tenantId
  const [region] = await createDb(c.env)
    .select({ id: regions.id })
    .from(regions)
    .where(and(eq(regions.id, regionId), eq(regions.tenantId, tenantId)))
    .limit(1)
  return region ?? false
}

function branchPredicate<T extends { branchId: any }>(table: T, branchId: string | null) {
  return branchId ? eq(table.branchId, branchId) : isNull(table.branchId)
}

function optionalOrderBranchPredicate<T extends { branchId: any }>(table: T, branchId: string | null) {
  return branchId ? eq(table.branchId, branchId) : undefined
}

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000
export type AnalyticsPeriod = 'today' | 'week' | 'month'

export function getMalaysiaDayStart(now = new Date()) {
  const malaysiaNow = new Date(now.getTime() + MALAYSIA_OFFSET_MS)
  malaysiaNow.setUTCHours(0, 0, 0, 0)
  return new Date(malaysiaNow.getTime() - MALAYSIA_OFFSET_MS)
}

export function getAnalyticsRange(period: AnalyticsPeriod, now = new Date()) {
  const malaysiaNow = new Date(now.getTime() + MALAYSIA_OFFSET_MS)
  const start = new Date(malaysiaNow)
  start.setUTCHours(0, 0, 0, 0)

  if (period === 'week') {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7
    start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  } else if (period === 'month') {
    start.setUTCDate(1)
  }

  return {
    start: new Date(start.getTime() - MALAYSIA_OFFSET_MS),
    end: now,
    granularity: period === 'today' ? 'hour' as const : 'day' as const,
  }
}

dashboardRoutes.get('/summary', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  const region = await resolveRegion(c)
  if (branch === false || region === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const periodParam = c.req.query('period') ?? 'today'
  if (periodParam !== 'today' && periodParam !== 'week' && periodParam !== 'month') return c.json({ error: 'invalid_period' }, 400)
  const period = periodParam as AnalyticsPeriod
  const range = getAnalyticsRange(period)
  const db = createDb(c.env)
  const regionPredicate = region
    ? inArray(orders.branchId, db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.regionId, region.id))))
    : undefined
  const rangePredicate = and(optionalOrderBranchPredicate(orders, branchId), regionPredicate, gte(orders.createdAt, range.start), lt(orders.createdAt, range.end))
  const analyticsOrders = await db
    .select({ id: orders.id, createdAt: orders.createdAt, totalSen: orders.totalSen })
    .from(orders)
    .where(scoped(orders, tenantId, rangePredicate))

  const trend = new Map<string, { orderCount: number; totalSen: number }>()
  for (const order of analyticsOrders) {
    const malaysiaTime = new Date(order.createdAt.getTime() + MALAYSIA_OFFSET_MS)
    const key = range.granularity === 'hour'
      ? `${String(malaysiaTime.getUTCHours()).padStart(2, '0')}:00`
      : malaysiaTime.toISOString().slice(0, 10)
    const point = trend.get(key) ?? { orderCount: 0, totalSen: 0 }
    point.orderCount += 1
    point.totalSen += order.totalSen
    trend.set(key, point)
  }

  const itemRows = await db
    .select({ productName: orderItems.productNameSnapshot, quantity: orderItems.quantity, unitPriceSen: orderItems.unitPriceSenSnapshot })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.tenantId, tenantId), eq(orders.tenantId, tenantId), rangePredicate))
  const topProducts = new Map<string, { quantity: number; totalSen: number }>()
  for (const item of itemRows) {
    const product = topProducts.get(item.productName) ?? { quantity: 0, totalSen: 0 }
    product.quantity += item.quantity
    product.totalSen += item.quantity * item.unitPriceSen
    topProducts.set(item.productName, product)
  }

  const totalSen = analyticsOrders.reduce((sum, order) => sum + order.totalSen, 0)
  return c.json({
    period,
    orderCount: analyticsOrders.length,
    totalSen,
    averageOrderValueSen: analyticsOrders.length > 0 ? Math.round(totalSen / analyticsOrders.length) : 0,
    trend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, values]) => ({ label, ...values })),
    topProducts: [...topProducts.entries()]
      .sort(([, a], [, b]) => b.quantity - a.quantity || b.totalSen - a.totalSen)
      .slice(0, 5)
      .map(([name, values]) => ({ name, ...values })),
  })
})

dashboardRoutes.get('/orders', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  const region = await resolveRegion(c)
  if (branch === false || region === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const status = parseOptionalStatus(c.req.query('status'))
  if (status === null) return c.json({ error: 'invalid_status' }, 400)
  const { limit, offset } = parsePagination(c)
  const db = createDb(c.env)
  const regionPredicate = region
    ? inArray(orders.branchId, db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.regionId, region.id))))
    : undefined
  const predicate = scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), regionPredicate, status ? eq(orders.status, status) : undefined))

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalSen: orders.totalSen,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      remark: orders.remark,
      hasPaymentReceipt: orders.paymentReceiptKey,
      notificationStatus: notificationJobs.status,
      notificationError: notificationJobs.errorCategory,
      regionName: regions.name,
      branchName: branches.name,
    })
    .from(orders)
    .innerJoin(
      customers,
      and(eq(customers.id, orders.customerId), eq(customers.tenantId, tenantId)),
    )
    .leftJoin(
      notificationJobs,
      and(eq(notificationJobs.orderId, orders.id), eq(notificationJobs.tenantId, tenantId)),
    )
    .leftJoin(
      branches,
      and(eq(branches.id, orders.branchId), eq(branches.tenantId, tenantId)),
    )
    .leftJoin(
      regions,
      and(eq(regions.id, branches.regionId), eq(regions.tenantId, tenantId)),
    )
    .where(predicate)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit)
    .offset(offset)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(predicate)

  return c.json({
    orders: rows.map((row) => ({ ...row, hasPaymentReceipt: Boolean(row.hasPaymentReceipt) })),
    pagination: { limit, offset, total: Number(count ?? 0) },
  })
})

dashboardRoutes.post('/orders/order-list/send-now', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const region = await resolveRegion(c)
  if (region === false) return c.json({ error: 'not_found' }, 404)
  try {
    const orderCount = await sendOrderListNow(c.env, tenantId, region?.id)
    if (orderCount === null) return c.json({ error: 'not_found' }, 404)
    if (orderCount === 0) return c.json({ error: 'no_pending_orders' }, 409)
    return c.json({ sent: true, orderCount })
  } catch (error) {
    if (error instanceof TelegramError) {
      const status = error.code === 'telegram_not_configured' ? 503 : 502
      return c.json({ error: error.code }, status)
    }
    console.error('Manual order list send failed', error)
    return c.json({ error: 'order_list_send_failed' }, 500)
  }
})

dashboardRoutes.get('/orders/:orderId', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalSen: orders.totalSen,
      createdAt: orders.createdAt,
      remark: orders.remark,
      hasPaymentReceipt: orders.paymentReceiptKey,
      customer: {
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
      },
    })
    .from(orders)
    .innerJoin(
      customers,
      and(eq(customers.id, orders.customerId), eq(customers.tenantId, tenantId)),
    )
    .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), eq(orders.id, orderId))))
    .limit(1)

  if (!order) return c.json({ error: 'not_found' }, 404)

  const [items, [notification]] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(scoped(orderItems, tenantId, eq(orderItems.orderId, orderId)))
      .orderBy(asc(orderItems.id)),
    db
      .select({
        status: notificationJobs.status,
        attemptCount: notificationJobs.attemptCount,
        lastAttemptAt: notificationJobs.lastAttemptAt,
        nextRetryAt: notificationJobs.nextRetryAt,
        errorCategory: notificationJobs.errorCategory,
      })
      .from(notificationJobs)
      .where(scoped(notificationJobs, tenantId, eq(notificationJobs.orderId, orderId)))
      .limit(1),
  ])

  return c.json({ order: { ...order, hasPaymentReceipt: Boolean(order.hasPaymentReceipt), items, notification: notification ?? null } })
})

dashboardRoutes.get('/orders/:orderId/payment-receipt', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const orderId = c.req.param('orderId')
  const [order] = await createDb(c.env)
    .select({ orderNumber: orders.orderNumber, paymentReceiptKey: orders.paymentReceiptKey, paymentReceiptContentType: orders.paymentReceiptContentType })
    .from(orders)
    .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branch?.id ?? null), eq(orders.id, orderId))))
    .limit(1)
  if (!order?.paymentReceiptKey) return c.json({ error: 'not_found' }, 404)
  const object = await c.env.DOCS_BUCKET.get(order.paymentReceiptKey)
  if (!object) return c.json({ error: 'not_found' }, 404)
  const extension = order.paymentReceiptContentType === 'application/pdf' ? 'pdf' : 'jpg'
  const disposition = c.req.query('download') === '1'
    ? `attachment; filename="payment-receipt-${order.orderNumber}.${extension}"`
    : 'inline'
  return new Response(object.body, { headers: { 'content-type': order.paymentReceiptContentType ?? object.httpMetadata?.contentType ?? 'application/octet-stream', 'content-disposition': disposition, 'cache-control': 'private, no-store' } })
})

dashboardRoutes.get('/orders/:orderId/pdf', requireRole('staff'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [row] = await db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalSen: orders.totalSen,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      remark: orders.remark,
      organizationName: tenants.name,
    })
    .from(orders)
    .innerJoin(
      customers,
      and(eq(customers.id, orders.customerId), eq(customers.tenantId, tenantId)),
    )
    .innerJoin(tenants, eq(tenants.id, tenantId))
    .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), eq(orders.id, orderId))))
    .limit(1)

  if (!row) return c.json({ error: 'not_found' }, 404)
  const items = await db
    .select({
      productNameSnapshot: orderItems.productNameSnapshot,
      unitPriceSenSnapshot: orderItems.unitPriceSenSnapshot,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(scoped(orderItems, tenantId, eq(orderItems.orderId, orderId)))
    .orderBy(asc(orderItems.id))

  const key = `private/${tenantId}/orders/${orderId}-v2.pdf`
  const cached = await c.env.DOCS_BUCKET.get(key)
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="order-${row.orderNumber}.pdf"`,
        'cache-control': 'private, no-store',
      },
    })
  }

  const fontBytes = await loadOrderPdfFont(c.env.DOCS_BUCKET)
  const pdf = await renderOrderPdf({ ...row, items }, { fontBytes })
  await c.env.DOCS_BUCKET.put(key, pdf, {
    httpMetadata: { contentType: 'application/pdf' },
  })
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="order-${row.orderNumber}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
})

dashboardRoutes.patch('/orders/:orderId/status', requireRole('staff'), async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)

  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const userId = c.get('auth').userId
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), eq(orders.id, orderId))))
    .limit(1)

  if (!order) return c.json({ error: 'not_found' }, 404)
  if (!allowedTransitions[order.status].includes(parsed.data.status)) {
    return c.json({ error: 'invalid_status_transition' }, 400)
  }

  await db.batch([
    db
      .update(orders)
      .set({ status: parsed.data.status })
      .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), eq(orders.id, orderId)))),
    db.insert(auditLogs).values({
      id: newId('audit'),
      tenantId,
      userId,
      action: 'order.status_changed',
      targetType: 'order',
      targetId: orderId,
    }),
  ])

  return c.json({ orderId, status: parsed.data.status })
})

dashboardRoutes.post('/orders/:orderId/notification/retry', requireRole('staff'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const userId = c.get('auth').userId
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(scoped(orders, tenantId, and(optionalOrderBranchPredicate(orders, branchId), eq(orders.id, orderId))))
    .limit(1)
  if (!order) return c.json({ error: 'not_found' }, 404)
  const [job] = await db
    .select()
    .from(notificationJobs)
    .where(scoped(notificationJobs, tenantId, eq(notificationJobs.orderId, orderId)))
    .limit(1)
  if (!job) return c.json({ error: 'not_found' }, 404)
  if (job.status === 'sent' || job.status === 'processing') return c.json({ error: 'notification_not_retryable' }, 409)
  await db.batch([
    db.update(notificationJobs).set({ status: 'pending', nextRetryAt: null, errorCategory: null }).where(eq(notificationJobs.id, job.id)),
    db.insert(auditLogs).values({ id: newId('audit'), tenantId, userId, action: 'notification.retry_requested', targetType: 'notification_job', targetId: job.id }),
  ])
  return c.json({ orderId, status: 'pending' })
})

dashboardRoutes.get('/categories', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const db = createDb(c.env)
  const rows = await db
    .select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
    .from(categories)
    .where(scoped(categories, tenantId, branchPredicate(categories, branchId)))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
  return c.json({ categories: rows })
})

const categorySchema = z.object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int().min(-10000).max(10000).default(0) })

dashboardRoutes.post('/categories', requireRole('admin'), async (c) => {
  const parsed = categorySchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const id = newId('cat')
  await createDb(c.env).insert(categories).values({ id, tenantId, branchId: branch?.id ?? null, ...parsed.data })
  return c.json({ category: { id, tenantId, branchId: branch?.id ?? null, ...parsed.data } }, 201)
})

dashboardRoutes.patch('/categories/:categoryId', requireRole('admin'), async (c) => {
  const parsed = categorySchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const categoryId = c.req.param('categoryId')
  const result = await createDb(c.env)
    .update(categories)
    .set(parsed.data)
    .where(scoped(categories, tenantId, and(branchPredicate(categories, branch?.id ?? null), eq(categories.id, categoryId))))
  if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  return c.json({ categoryId, ...parsed.data })
})

dashboardRoutes.delete('/categories/:categoryId', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const categoryId = c.req.param('categoryId')
  const db = createDb(c.env)
  const categoryScope = scoped(categories, tenantId, and(branchPredicate(categories, branch?.id ?? null), eq(categories.id, categoryId)))
  const [category] = await db.select({ id: categories.id }).from(categories).where(categoryScope).limit(1)
  if (!category) return c.json({ error: 'not_found' }, 404)

  const productScope = scoped(products, tenantId, and(branchPredicate(products, branch?.id ?? null), eq(products.categoryId, categoryId)))
  const [, deletedCategory] = await db.batch([
    db.update(products).set({ categoryId: null }).where(productScope),
    db.delete(categories).where(categoryScope),
  ])
  if (deletedCategory.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  return c.json({ deleted: true })
})

dashboardRoutes.get('/products', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const branchId = branch?.id ?? null
  const db = createDb(c.env)
  const rows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      categoryName: categories.name,
      name: products.name,
      imageUrl: products.imageUrl,
      priceSen: products.priceSen,
      isPublic: products.isPublic,
      isAvailable: products.isAvailable,
      serviceDate: products.serviceDate,
      servicePeriod: products.servicePeriod,
      orderCutoffAt: products.orderCutoffAt,
      weeklyDay: products.weeklyDay,
      weeklyCutoffTime: products.weeklyCutoffTime,
    })
    .from(products)
    .leftJoin(
      categories,
      and(eq(categories.id, products.categoryId), eq(categories.tenantId, tenantId), branchPredicate(categories, branchId)),
    )
    .where(scoped(products, tenantId, branchPredicate(products, branchId)))
    .orderBy(asc(products.name))
  const prices = rows.length
    ? await db.select({ productId: scheduledMealPrices.productId, pricingRuleId: scheduledMealPrices.pricingRuleId, priceSen: scheduledMealPrices.priceSen })
      .from(scheduledMealPrices)
      .where(and(eq(scheduledMealPrices.tenantId, tenantId), inArray(scheduledMealPrices.productId, rows.map((row) => row.id))))
    : []
  const pricesByProductId = new Map<string, { pricingRuleId: string; priceSen: number }[]>()
  for (const price of prices) pricesByProductId.set(price.productId, [...(pricesByProductId.get(price.productId) ?? []), price])
  return c.json({ products: rows.map((row) => ({ ...row, rulePrices: pricesByProductId.get(row.id) ?? [] })) })
})

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  imageUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/, 'invalid_image').max(2800000).nullable().optional(),
  priceSen: z.number().int().min(0).max(100000000),
  categoryId: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  kind: z.enum(['add_on', 'scheduled_meal', 'recurring_meal']).optional(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  servicePeriod: z.enum(['lunch', 'dinner']).optional(),
  cutoffMalaysiaTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  weeklyDay: z.number().int().min(1).max(5).optional(),
  weeklyCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  rulePrices: z.array(z.object({ pricingRuleId: z.string().min(1), priceSen: z.number().int().min(0).max(100000000) })).optional(),
})

function normalizeEmptyScheduleFields(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const normalized = { ...(body as Record<string, unknown>) }
  for (const field of ['serviceDate', 'servicePeriod', 'cutoffMalaysiaTime', 'weeklyDay', 'weeklyCutoffTime']) {
    if (normalized[field] === '') delete normalized[field]
  }
  return normalized
}

async function buildScheduledMealValues(db: ReturnType<typeof createDb>, tenantId: string, branchId: string | null, data: z.infer<typeof productSchema>) {
  if (data.kind === 'add_on') return { serviceDate: null, servicePeriod: null, orderCutoffAt: null, weeklyDay: null, weeklyCutoffTime: null, rulePrices: [] as { pricingRuleId: string; priceSen: number }[] }
  const recurring = data.kind === 'recurring_meal'
  if ((!recurring && data.kind !== 'scheduled_meal') || !data.servicePeriod || !data.rulePrices) return null
  if (recurring ? data.weeklyDay === undefined || !data.weeklyCutoffTime : !data.serviceDate || !data.cutoffMalaysiaTime) return null
  if (new Set(data.rulePrices.map((price) => price.pricingRuleId)).size !== data.rulePrices.length) return null

  const [branchRule] = branchId
    ? await db.select({ id: pricingRules.id }).from(pricingRules).innerJoin(branches, eq(branches.pricingRuleId, pricingRules.id))
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId), eq(pricingRules.tenantId, tenantId), eq(pricingRules.isActive, true))).limit(1)
    : []
  if (!branchRule || !data.rulePrices.some((price) => price.pricingRuleId === branchRule.id)) return null

  const activeRules = await db.select({ id: pricingRules.id }).from(pricingRules)
    .where(and(eq(pricingRules.tenantId, tenantId), eq(pricingRules.isActive, true)))
  const activeRuleIds = new Set(activeRules.map((rule) => rule.id))
  if (data.rulePrices.some((price) => !activeRuleIds.has(price.pricingRuleId))) return null

  try {
    return {
      serviceDate: data.serviceDate,
      servicePeriod: data.servicePeriod,
      orderCutoffAt: recurring ? null : parseMalaysiaCutoff(data.serviceDate!, data.cutoffMalaysiaTime!),
      weeklyDay: recurring ? data.weeklyDay! : null,
      weeklyCutoffTime: recurring ? data.weeklyCutoffTime! : null,
      rulePrices: data.rulePrices,
    }
  } catch {
    return null
  }
}

async function ensureCategory(c: DashboardContext, categoryId: string | null | undefined, tenantId: string) {
  if (categoryId === undefined || categoryId === null) return true
  const branch = await resolveBranch(c)
  if (branch === false) return false
  const [category] = await createDb(c.env)
    .select({ id: categories.id })
    .from(categories)
    .where(scoped(categories, tenantId, and(branchPredicate(categories, branch?.id ?? null), eq(categories.id, categoryId))))
    .limit(1)
  return Boolean(category)
}

dashboardRoutes.post('/products', requireRole('admin'), async (c) => {
  const parsed = productSchema.safeParse(normalizeEmptyScheduleFields(await c.req.json().catch(() => null)))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  if (!(await ensureCategory(c, parsed.data.categoryId, tenantId))) return c.json({ error: 'invalid_category' }, 400)
  const db = createDb(c.env)
  const schedule = await buildScheduledMealValues(db, tenantId, branch?.id ?? null, parsed.data)
  if (parsed.data.kind && parsed.data.kind !== 'add_on' && !schedule) return c.json({ error: 'invalid_scheduled_meal' }, 400)
  const id = newId('prod')
  const values = {
    id,
    tenantId,
    branchId: branch?.id ?? null,
    name: parsed.data.name,
    imageUrl: parsed.data.imageUrl ?? null,
    priceSen: parsed.data.priceSen,
    categoryId: parsed.data.categoryId ?? null,
    isPublic: parsed.data.isPublic ?? true,
    isAvailable: parsed.data.isAvailable ?? true,
    serviceDate: schedule?.serviceDate ?? null,
    servicePeriod: schedule?.servicePeriod ?? null,
    orderCutoffAt: schedule?.orderCutoffAt ?? null,
    weeklyDay: schedule?.weeklyDay ?? null,
    weeklyCutoffTime: schedule?.weeklyCutoffTime ?? null,
  }
  await db.insert(products).values(values)
  if (schedule?.rulePrices.length) {
    await db.insert(scheduledMealPrices).values(schedule.rulePrices.map((price) => ({
      id: newId('scheduled-price'), tenantId, productId: id, ...price,
    })))
  }
  return c.json({ product: values }, 201)
})

dashboardRoutes.patch('/products/:productId', requireRole('admin'), async (c) => {
  const parsed = productSchema.partial().safeParse(normalizeEmptyScheduleFields(await c.req.json().catch(() => null)))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const productId = c.req.param('productId')
  if (!(await ensureCategory(c, parsed.data.categoryId, tenantId))) return c.json({ error: 'invalid_category' }, 400)
  const db = createDb(c.env)
  const schedule = parsed.data.kind
    ? await buildScheduledMealValues(db, tenantId, branch?.id ?? null, parsed.data as z.infer<typeof productSchema>)
    : undefined
  if (parsed.data.kind && parsed.data.kind !== 'add_on' && !schedule) return c.json({ error: 'invalid_scheduled_meal' }, 400)
  const { kind: _kind, cutoffMalaysiaTime: _cutoffMalaysiaTime, rulePrices: _rulePrices, ...productData } = parsed.data
  const result = await db
    .update(products)
    .set({
      ...productData,
      ...(schedule ? {
        serviceDate: schedule.serviceDate,
        servicePeriod: schedule.servicePeriod,
        orderCutoffAt: schedule.orderCutoffAt,
        weeklyDay: schedule.weeklyDay,
        weeklyCutoffTime: schedule.weeklyCutoffTime,
      } : {}),
    })
    .where(scoped(products, tenantId, and(branchPredicate(products, branch?.id ?? null), eq(products.id, productId))))
  if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  if (parsed.data.kind) {
    await db.delete(scheduledMealPrices).where(and(eq(scheduledMealPrices.tenantId, tenantId), eq(scheduledMealPrices.productId, productId)))
    if (schedule?.rulePrices.length) await db.insert(scheduledMealPrices).values(schedule.rulePrices.map((price) => ({
      id: newId('scheduled-price'), tenantId, productId, ...price,
    })))
  }
  return c.json({ productId, ...parsed.data })
})

dashboardRoutes.delete('/products/:productId', requireRole('admin'), async (c) => {
  const tenantId = c.get('tenant').tenantId
  const branch = await resolveBranch(c)
  if (branch === false) return c.json({ error: 'not_found' }, 404)
  const productId = c.req.param('productId')
  const db = createDb(c.env)
  const productScope = scoped(products, tenantId, and(branchPredicate(products, branch?.id ?? null), eq(products.id, productId)))
  const [product] = await db.select({ id: products.id }).from(products).where(productScope).limit(1)
  if (!product) return c.json({ error: 'not_found' }, 404)

  const imageScope = and(eq(productImages.tenantId, tenantId), eq(productImages.productId, productId))
  const scheduledPriceScope = and(eq(scheduledMealPrices.tenantId, tenantId), eq(scheduledMealPrices.productId, productId))
  const images = await db.select({ r2Key: productImages.r2Key }).from(productImages).where(imageScope)
  const [, , deletedProduct] = await db.batch([
    db.delete(scheduledMealPrices).where(scheduledPriceScope),
    db.delete(productImages).where(imageScope),
    db.delete(products).where(productScope),
  ])
  if (deletedProduct.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
  await Promise.all(images.map((image) => c.env.DOCS_BUCKET.delete(image.r2Key)))
  return c.json({ deleted: true })
})

dashboardRoutes.get('/settings', async (c) => {
  const tenantId = c.get('tenant').tenantId
  const db = createDb(c.env)
  const [[tenant], [settings]] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select({ businessInfo: tenantSettings.businessInfo, orderListSendTime: tenantSettings.orderListSendTime }).from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1),
  ])
  return c.json({ tenant, settings: settings ?? { businessInfo: null, orderListSendTime: null } })
})

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid_slug').optional(),
  businessInfo: z.record(z.string(), z.unknown()).nullable().optional(),
  orderListSendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
})

dashboardRoutes.patch('/settings', requireRole('admin'), async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return c.json({ error: 'invalid_input' }, 400)
  const tenantId = c.get('tenant').tenantId
  const db = createDb(c.env)
  const { name, slug, ...settingsData } = parsed.data
  if (name !== undefined || slug !== undefined) {
    if (slug !== undefined) {
      const [slugOwner] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
      if (slugOwner && slugOwner.id !== tenantId) return c.json({ error: 'slug_taken' }, 409)
    }
    try {
      const result = await db.update(tenants).set({
        ...(name !== undefined ? { name } : {}),
        ...(slug !== undefined ? { slug } : {}),
      }).where(eq(tenants.id, tenantId))
      if (result.meta?.changes !== 1) return c.json({ error: 'not_found' }, 404)
    } catch (err) {
      if (String(err).includes('tenants_slug_unique')) return c.json({ error: 'slug_taken' }, 409)
      throw err
    }
  }
  if (Object.keys(settingsData).length === 0) return c.json({ tenant: { name, slug } })
  const [existing] = await db.select({ tenantId: tenantSettings.tenantId }).from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1)
  if (existing) {
    await db.update(tenantSettings).set({ ...settingsData, updatedAt: new Date() }).where(eq(tenantSettings.tenantId, tenantId))
  } else {
    await db.insert(tenantSettings).values({ tenantId, ...settingsData })
  }
  return c.json({ settings: settingsData, tenant: { name, slug } })
})

dashboardRoutes.get('/telegram-accounts', requirePlatformAdmin, async (c) => {
  const rows = await createDb(c.env)
    .select({ id: users.id, username: users.username, configured: accountTelegramSettings.accountUserId })
    .from(users)
    .leftJoin(accountTelegramSettings, eq(accountTelegramSettings.accountUserId, users.id))
    .where(eq(users.isPlatformAdmin, false))
    .orderBy(asc(users.username))
  return c.json({ accounts: rows.map((row) => ({ id: row.id, username: row.username, configured: Boolean(row.configured) })) })
})

async function resolveTelegramAccount(c: DashboardContext, accountUserId: string | undefined) {
  if (!accountUserId) return null
  const [account] = await createDb(c.env)
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, accountUserId), eq(users.isPlatformAdmin, false)))
    .limit(1)
  return account ?? null
}

dashboardRoutes.get('/telegram-settings', requirePlatformAdmin, async (c) => {
  const accountUserId = c.req.query('accountUserId')
  if (!(await resolveTelegramAccount(c, accountUserId))) return c.json({ error: 'account_not_found' }, 404)
  const [setting] = await createDb(c.env)
    .select({ value: accountTelegramSettings.value })
    .from(accountTelegramSettings)
    .where(eq(accountTelegramSettings.accountUserId, accountUserId!))
    .limit(1)
  if (!setting) return c.json({ configured: false, chatId: '' })
  const encryptionKey = c.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY
  if (!encryptionKey) return c.json({ error: 'telegram_encryption_not_configured' }, 503)
  try {
    const config = JSON.parse(await decryptSecret(setting.value, encryptionKey)) as { chatId?: string }
    return c.json({ configured: Boolean(config.chatId), chatId: config.chatId ?? '' })
  } catch {
    return c.json({ error: 'telegram_settings_unreadable' }, 503)
  }
})

const telegramSettingsSchema = z.object({
  accountUserId: z.string().min(1),
  botToken: z.string().trim().min(1).max(500).optional(),
  chatId: z.string().trim().min(1).max(200),
})

dashboardRoutes.put('/telegram-settings', requirePlatformAdmin, async (c) => {
  const parsed = telegramSettingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  if (!(await resolveTelegramAccount(c, parsed.data.accountUserId))) return c.json({ error: 'account_not_found' }, 404)
  const encryptionKey = c.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY
  if (!encryptionKey) return c.json({ error: 'telegram_encryption_not_configured' }, 503)

  const db = createDb(c.env)
  const [existing] = await db.select({ value: accountTelegramSettings.value }).from(accountTelegramSettings).where(eq(accountTelegramSettings.accountUserId, parsed.data.accountUserId)).limit(1)
  let botToken = parsed.data.botToken
  if (!botToken && existing) {
    try {
      const current = JSON.parse(await decryptSecret(existing.value, encryptionKey)) as { botToken?: string }
      botToken = current.botToken
    } catch {
      return c.json({ error: 'telegram_settings_unreadable' }, 503)
    }
  }
  if (!botToken) return c.json({ error: 'bot_token_required' }, 400)

  const encrypted = await encryptSecret(JSON.stringify({ botToken, chatId: parsed.data.chatId }), encryptionKey)
  await db.insert(accountTelegramSettings).values({ accountUserId: parsed.data.accountUserId, value: encrypted, updatedAt: new Date() })
    .onConflictDoUpdate({ target: accountTelegramSettings.accountUserId, set: { value: encrypted, updatedAt: new Date() } })
  return c.json({ configured: true, chatId: parsed.data.chatId })
})

dashboardRoutes.post('/telegram-settings/test', requirePlatformAdmin, async (c) => {
  const parsed = z.object({ accountUserId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  if (!(await resolveTelegramAccount(c, parsed.data.accountUserId))) return c.json({ error: 'account_not_found' }, 404)
  try {
    await sendTelegramTestMessage(c.env, createDb(c.env), parsed.data.accountUserId)
    return c.json({ sent: true })
  } catch (error) {
    if (error instanceof TelegramError) return c.json({ error: error.code }, error.code === 'telegram_not_configured' ? 400 : 502)
    throw error
  }
})
