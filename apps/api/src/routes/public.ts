import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { createDb } from '../db/client'
import { branches, categories, orders, products, tenantSettings } from '../db/schema'
import { scoped } from '../repositories/scoped'
import { resolvePublicTenant } from '../auth/middleware'
import { createOrder, OrderValidationError } from '../services/orders'
import { expandWeeklyProduct, getMalaysiaDate, isScheduledMeal, isWeeklyMeal, resolveEffectiveProductPrices } from '../services/scheduled-meals'
import type { Env, AppVariables } from '../types'
import { isUploadFile, uploadErrorResponse, validateUpload } from '../services/uploads'

export const publicRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()

publicRoutes.use('*', resolvePublicTenant)

publicRoutes.get('/', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const db = createDb(c.env)

  const [settings] = await db
    .select({ businessInfo: tenantSettings.businessInfo })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenant.id))
    .limit(1)
  const [qrBranch] = branch ? await db.select({ paymentQrKey: branches.paymentQrKey }).from(branches).where(eq(branches.id, branch.id)).limit(1) : []
  const [defaultBranch] = !qrBranch?.paymentQrKey && branch ? await db.select({ id: branches.id, paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.regionId, branch.regionId), eq(branches.isDefault, true))).limit(1) : []
  const paymentQrBranchId = qrBranch?.paymentQrKey ? branch?.id : defaultBranch?.paymentQrKey ? defaultBranch.id : null

  return c.json({
    name: tenant.name,
    slug: tenant.slug,
    location: branch ? { slug: branch.slug, name: branch.name } : null,
    businessInfo: settings?.businessInfo ?? null,
    paymentQrUrl: paymentQrBranchId && branch ? `/api/public/${tenant.slug}/${branch.regionSlug}/${branch.slug}/payment-qr` : null,
  })
})

publicRoutes.get('/payment-qr', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const db = createDb(c.env)
  const [selected] = branch ? await db.select({ id: branches.id, paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.id, branch.id), eq(branches.tenantId, tenant.id))).limit(1) : []
  const [fallback] = !selected?.paymentQrKey && branch ? await db.select({ id: branches.id, paymentQrKey: branches.paymentQrKey }).from(branches).where(and(eq(branches.regionId, branch.regionId), eq(branches.isDefault, true))).limit(1) : []
  const key = selected?.paymentQrKey ?? fallback?.paymentQrKey
  if (!key) return c.json({ error: 'not_found' }, 404)
  const object = await c.env.DOCS_BUCKET.get(key)
  if (!object) return c.json({ error: 'not_found' }, 404)
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'public, max-age=300' } })
})

publicRoutes.get('/categories', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const db = createDb(c.env)

  const rows = await db
    .select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
    .from(categories)
    .where(scoped(categories, tenant.id, branch ? eq(categories.branchId, branch.id) : isNull(categories.branchId)))
    .orderBy(asc(categories.sortOrder))

  return c.json({ categories: rows })
})

publicRoutes.get('/products', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const db = createDb(c.env)

  const rows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      name: products.name,
      imageUrl: products.imageUrl,
      priceSen: products.priceSen,
      serviceDate: products.serviceDate,
      servicePeriod: products.servicePeriod,
      orderCutoffAt: products.orderCutoffAt,
      weeklyDay: products.weeklyDay,
      weeklyCutoffTime: products.weeklyCutoffTime,
      isPublic: products.isPublic,
      isAvailable: products.isAvailable,
    })
    .from(products)
    .where(
      scoped(products, tenant.id, and(eq(products.isPublic, true), eq(products.isAvailable, true), branch ? eq(products.branchId, branch.id) : isNull(products.branchId))),
    )

  const ordinaryProducts = rows.filter((product) => !isScheduledMeal(product))
  const scheduledRows = rows.filter(isScheduledMeal).filter((product) => !branch?.deliveryPeriod || product.servicePeriod === branch.deliveryPeriod)
  const weeklyRows = scheduledRows.filter(isWeeklyMeal)
  const malaysiaToday = getMalaysiaDate(new Date())
  const datedRows = scheduledRows.filter((product) => !isWeeklyMeal(product) && product.serviceDate === malaysiaToday)
  const expandedWeeklyRows = branch ? weeklyRows.flatMap((product) => expandWeeklyProduct(product, malaysiaToday, 1)) : []
  const scheduledProducts = branch
    ? await resolveEffectiveProductPrices(db, tenant.id, branch.id, [...datedRows, ...expandedWeeklyRows])
    : []
  return c.json({
    products: [
      ...ordinaryProducts.map(({ isPublic, isAvailable, weeklyDay, weeklyCutoffTime, ...product }) => product),
      ...scheduledProducts.map(({ effectivePriceSen, pricingRuleName, isPublic, isAvailable, weeklyDay, weeklyCutoffTime, ...product }) => ({
        ...product,
        priceSen: effectivePriceSen,
        orderCutoffAt: product.orderCutoffAt?.toISOString() ?? null,
      })),
    ],
  })
})

const createOrderSchema = z.object({
  idempotencyKey: z.string().min(1).max(100),
  remark: z.string().trim().max(500).optional().default(''),
  customer: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(7).max(20),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(100),
        serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(50),
})

publicRoutes.post('/orders', async (c) => {
  const parsed = createOrderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'invalid_input' }, 400)
  }

  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const db = createDb(c.env)

  try {
    const order = await createOrder(db, tenant.id, parsed.data, branch?.id ?? null)
    if (!order) {
      return c.json({ error: 'order_failed' }, 500)
    }
    return c.json(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalSen: order.totalSen,
        status: order.status,
      },
      201,
    )
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return c.json({ error: 'invalid_order' }, 400)
    }
    throw err
  }
})

publicRoutes.post('/orders/:orderId/payment-receipt', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [order] = await db.select({ id: orders.id, paymentReceiptKey: orders.paymentReceiptKey }).from(orders).where(scoped(orders, tenant.id, and(eq(orders.id, orderId), branch ? eq(orders.branchId, branch.id) : isNull(orders.branchId)))).limit(1)
  if (!order) return c.json({ error: 'not_found' }, 404)
  const body = await c.req.parseBody()
  const file = body.file
  if (!isUploadFile(file)) return c.json({ error: 'invalid_file' }, 400)
  const validated = await validateUpload(file, 'receipt')
  const uploadError = uploadErrorResponse(validated)
  if (uploadError) return c.json({ error: uploadError.error }, uploadError.status as 400 | 413)
  if (!validated || validated === 'too_large') return c.json({ error: 'invalid_file' }, 400)
  const key = `private/${tenant.id}/orders/${orderId}/payment-receipt.${validated.extension}`
  await c.env.DOCS_BUCKET.put(key, validated.bytes, { httpMetadata: { contentType: validated.contentType } })
  if (order.paymentReceiptKey && order.paymentReceiptKey !== key) await c.env.DOCS_BUCKET.delete(order.paymentReceiptKey)
  await db.update(orders).set({ paymentReceiptKey: key, paymentReceiptContentType: validated.contentType, paymentReceiptUploadedAt: new Date() }).where(scoped(orders, tenant.id, eq(orders.id, orderId)))
  return c.json({ orderId, uploaded: true })
})

publicRoutes.delete('/orders/:orderId/payment-receipt', async (c) => {
  const tenant = c.get('publicTenant')
  const branch = c.get('publicBranch')
  const orderId = c.req.param('orderId')
  const db = createDb(c.env)
  const [order] = await db
    .select({ id: orders.id, paymentReceiptKey: orders.paymentReceiptKey })
    .from(orders)
    .where(scoped(orders, tenant.id, and(eq(orders.id, orderId), branch ? eq(orders.branchId, branch.id) : isNull(orders.branchId))))
    .limit(1)
  if (!order?.paymentReceiptKey) return c.json({ error: 'not_found' }, 404)

  await db.update(orders)
    .set({ paymentReceiptKey: null, paymentReceiptContentType: null, paymentReceiptUploadedAt: null })
    .where(scoped(orders, tenant.id, eq(orders.id, orderId)))
  await c.env.DOCS_BUCKET.delete(order.paymentReceiptKey)
  return c.json({ orderId, deleted: true })
})
