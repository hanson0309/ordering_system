import { and, eq, inArray, isNull } from 'drizzle-orm'
import { branches, customers, orderItems, orders, notificationJobs, products } from '../db/schema'
import { scoped } from '../repositories/scoped'
import { newId } from '../lib/id'
import type { Db } from '../db/client'
import {
  isScheduledMeal,
  isScheduledMealOpen,
  isWeeklyMeal,
  getMalaysiaDate,
  getBranchPricingRule,
  malaysiaWeekday,
  parseMalaysiaCutoff,
  resolveEffectiveProductPrices,
} from './scheduled-meals'

export interface CreateOrderItemInput {
  productId: string
  quantity: number
  options?: Record<string, unknown>
  serviceDate?: string
}

export interface CreateOrderInput {
  idempotencyKey: string
  customer: { name: string; phone: string }
  remark?: string | null
  items: CreateOrderItemInput[]
}

export class OrderValidationError extends Error {}

function generateOrderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

/**
 * Creates an order for `tenantId`, computing all prices from the current
 * product rows server-side (client-submitted prices are never read). Product
 * ids are required to belong to this tenant and be public+available — this
 * is the IDOR guard against a storefront request referencing another
 * tenant's product id.
 *
 * Idempotent: a repeat call with the same `idempotencyKey` returns the
 * existing order rather than creating a duplicate.
 *
 * Atomicity: drizzle-orm's `transaction()` on the D1 driver sends BEGIN/
 * COMMIT/ROLLBACK as separate round trips and does not actually roll back on
 * D1 (upstream limitation). `db.batch([...])` calls the native
 * `D1Database.batch()`, which Cloudflare guarantees executes atomically, so
 * batch is used here instead of transaction().
 */
export async function createOrder(
  db: Db,
  tenantId: string,
  input: CreateOrderInput,
  branchId: string | null = null,
  now = new Date(),
) {
  const [existing] = await db
    .select()
    .from(orders)
    .where(scoped(orders, tenantId, and(eq(orders.idempotencyKey, input.idempotencyKey), branchId ? eq(orders.branchId, branchId) : isNull(orders.branchId))))
    .limit(1)
  if (existing) {
    return existing
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))]
  const productRows = await db
    .select()
    .from(products)
    .where(scoped(products, tenantId, and(inArray(products.id, productIds), branchId ? eq(products.branchId, branchId) : isNull(products.branchId))))

  const productById = new Map(productRows.map((p) => [p.id, p]))
  const [branch] = branchId ? await db.select({ deliveryPeriod: branches.deliveryPeriod }).from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId))).limit(1) : []
  for (const id of productIds) {
    const product = productById.get(id)
    if (!product || !product.isPublic || !product.isAvailable) {
      throw new OrderValidationError('invalid_product')
    }
  }
  const pricingRule = branchId ? await getBranchPricingRule(db, tenantId, branchId) : null

  const keyFor = (productId: string, serviceDate?: string) => `${productId}:${serviceDate ?? ''}`
  const scheduleByItem = new Map<string, typeof productRows[number]>()
  const scheduledOccurrences: typeof productRows = []
  const malaysiaToday = getMalaysiaDate(now)
  for (const item of input.items) {
    const product = productById.get(item.productId)!
    if (!isScheduledMeal(product)) {
      if (item.serviceDate) throw new OrderValidationError('invalid_scheduled_product')
      continue
    }
    let occurrence = product
    if (isWeeklyMeal(product)) {
      if (!item.serviceDate || item.serviceDate !== malaysiaToday || product.weeklyDay == null || !product.weeklyCutoffTime || !product.servicePeriod || malaysiaWeekday(item.serviceDate) !== product.weeklyDay) throw new OrderValidationError('invalid_scheduled_product')
      if (branch?.deliveryPeriod && branch.deliveryPeriod !== product.servicePeriod) throw new OrderValidationError('invalid_scheduled_product')
      occurrence = { ...product, serviceDate: item.serviceDate, orderCutoffAt: parseMalaysiaCutoff(item.serviceDate, product.weeklyCutoffTime) }
    } else {
      if (product.serviceDate !== malaysiaToday || (item.serviceDate && item.serviceDate !== product.serviceDate)) {
        throw new OrderValidationError('invalid_scheduled_product')
      }
    }
    const key = keyFor(item.productId, item.serviceDate)
    scheduleByItem.set(key, occurrence)
    scheduledOccurrences.push(occurrence)
  }
  const scheduledPrices = branchId ? await resolveEffectiveProductPrices(db, tenantId, branchId, scheduledOccurrences, now) : []
  const scheduledPriceByItem = new Map<string, typeof scheduledPrices[number]>()
  for (const [key, occurrence] of scheduleByItem) {
    const resolved = scheduledPrices.find((product) => product.id === occurrence.id && product.serviceDate === occurrence.serviceDate)
    if (resolved) scheduledPriceByItem.set(key, resolved)
  }
  for (const [key, product] of scheduleByItem) {
    if (!isScheduledMealOpen(product, now) || !scheduledPriceByItem.has(key)) throw new OrderValidationError('invalid_scheduled_product')
  }

  type EffectiveOrderItem = {
    priceSen: number
    serviceDate: string | null
    servicePeriod: 'lunch' | 'dinner' | null
    pricingRuleName: string | null
  }
  const effectivePriceByProductId = new Map<string, EffectiveOrderItem>(productRows.map((product) => [keyFor(product.id), {
    priceSen: product.priceSen,
    serviceDate: null,
    servicePeriod: null,
    pricingRuleName: null,
  }]))
  for (const [key, product] of scheduledPriceByItem) {
    effectivePriceByProductId.set(key, {
      priceSen: product.effectivePriceSen,
      serviceDate: product.serviceDate,
      servicePeriod: product.servicePeriod,
      pricingRuleName: product.pricingRuleName,
    })
  }

  const [existingCustomer] = await db
    .select()
    .from(customers)
    .where(scoped(customers, tenantId, eq(customers.phone, input.customer.phone)))
    .limit(1)

  const customerId = existingCustomer?.id ?? newId('cust')
  const totalSen = input.items.reduce((sum, item) => {
    return sum + effectivePriceByProductId.get(keyFor(item.productId, item.serviceDate))!.priceSen * item.quantity
  }, pricingRule?.deliveryFeeSen ?? 0)

  for (let attempt = 0; attempt < 3; attempt++) {
    const orderId = newId('order')
    const orderNumber = generateOrderNumber()

    const orderInsert = db.insert(orders).values({
      id: orderId,
      tenantId,
      branchId,
      orderNumber,
      customerId,
      remark: input.remark?.trim() || null,
      deliveryFeeSenSnapshot: pricingRule?.deliveryFeeSen ?? 0,
      pricingRuleNameSnapshot: pricingRule?.name ?? null,
      totalSen,
      idempotencyKey: input.idempotencyKey,
    })
    const itemsInsert = db.insert(orderItems).values(
      input.items.map((item) => ({
        id: newId('item'),
        tenantId,
        orderId,
        productNameSnapshot: productById.get(item.productId)!.name,
        unitPriceSenSnapshot: effectivePriceByProductId.get(keyFor(item.productId, item.serviceDate))!.priceSen,
        quantity: item.quantity,
        optionsSnapshot: item.options ?? null,
        serviceDateSnapshot: effectivePriceByProductId.get(keyFor(item.productId, item.serviceDate))!.serviceDate,
        servicePeriodSnapshot: effectivePriceByProductId.get(keyFor(item.productId, item.serviceDate))!.servicePeriod,
        pricingRuleNameSnapshot: effectivePriceByProductId.get(keyFor(item.productId, item.serviceDate))!.pricingRuleName,
      })),
    )
    const jobInsert = db.insert(notificationJobs).values({
      id: newId('njob'),
      tenantId,
      orderId,
      status: 'pending',
      idempotencyKey: orderId,
    })

    try {
      if (existingCustomer) {
        await db.batch([orderInsert, itemsInsert, jobInsert])
      } else {
        const customerInsert = db.insert(customers).values({
          id: customerId,
          tenantId,
          name: input.customer.name,
          phone: input.customer.phone,
        })
        await db.batch([customerInsert, orderInsert, itemsInsert, jobInsert])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('orders_tenant_idempotency_unique')) {
        const [race] = await db
          .select()
          .from(orders)
          .where(scoped(orders, tenantId, and(eq(orders.idempotencyKey, input.idempotencyKey), branchId ? eq(orders.branchId, branchId) : isNull(orders.branchId))))
          .limit(1)
        if (race) return race
      }
      if (message.includes('orders_tenant_order_number_unique')) {
        continue // regenerate orderNumber and retry
      }
      throw err
    }

    const [created] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    return created
  }

  throw new Error('order_number_collision_retry_exhausted')
}
