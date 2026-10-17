import { and, eq, inArray, isNull } from 'drizzle-orm'
import { customers, orderItems, orders, notificationJobs, products } from '../db/schema'
import { scoped } from '../repositories/scoped'
import { newId } from '../lib/id'
import type { Db } from '../db/client'

export interface CreateOrderItemInput {
  productId: string
  quantity: number
  options?: Record<string, unknown>
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
export async function createOrder(db: Db, tenantId: string, input: CreateOrderInput, branchId: string | null = null) {
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
  for (const id of productIds) {
    const product = productById.get(id)
    if (!product || !product.isPublic || !product.isAvailable) {
      throw new OrderValidationError('invalid_product')
    }
  }

  const [existingCustomer] = await db
    .select()
    .from(customers)
    .where(scoped(customers, tenantId, eq(customers.phone, input.customer.phone)))
    .limit(1)

  const customerId = existingCustomer?.id ?? newId('cust')
  const totalSen = input.items.reduce((sum, item) => {
    const product = productById.get(item.productId)!
    return sum + product.priceSen * item.quantity
  }, 0)

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
      totalSen,
      idempotencyKey: input.idempotencyKey,
    })
    const itemsInsert = db.insert(orderItems).values(
      input.items.map((item) => ({
        id: newId('item'),
        tenantId,
        orderId,
        productNameSnapshot: productById.get(item.productId)!.name,
        unitPriceSenSnapshot: productById.get(item.productId)!.priceSen,
        quantity: item.quantity,
        optionsSnapshot: item.options ?? null,
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
