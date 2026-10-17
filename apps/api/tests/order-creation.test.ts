import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { orders, orderItems, notificationJobs } from '../src/db/schema'
import { scoped } from '../src/repositories/scoped'
import { db, createTenant, createProduct, postPublicOrder } from './helpers'

describe('public order creation', () => {
  it('computes totalSen from server-side product prices, ignoring any client-submitted price', async () => {
    const tenant = await createTenant('NE', 'order-test-1')
    const productId = await createProduct(tenant, { name: 'Widget', priceSen: 1500 })

    const res = await postPublicOrder('order-test-1', {
      idempotencyKey: 'order-1',
      customer: { name: 'Alice', phone: '0111111111' },
      // A client-submitted price field, if present, must be ignored entirely.
      items: [{ productId, quantity: 3, price: 1 }],
    })

    expect(res.status).toBe(201)
    const body = await res.json<{ totalSen: number }>()
    expect(body.totalSen).toBe(4500)
  })

  it('resubmitting the same idempotencyKey returns the same order and creates no duplicate', async () => {
    const tenant = await createTenant('NE', 'order-test-2')
    const productId = await createProduct(tenant, { priceSen: 1000 })

    const payload = {
      idempotencyKey: 'order-2-idem',
      customer: { name: 'Bob', phone: '0122222222' },
      items: [{ productId, quantity: 1 }],
    }

    const first = await postPublicOrder('order-test-2', payload)
    const firstBody = await first.json<{ orderId: string }>()

    const second = await postPublicOrder('order-test-2', payload)
    const secondBody = await second.json<{ orderId: string }>()

    expect(secondBody.orderId).toBe(firstBody.orderId)

    const rows = await db()
      .select()
      .from(orders)
      .where(scoped(orders, tenant, eq(orders.idempotencyKey, 'order-2-idem')))
    expect(rows).toHaveLength(1)
  })

  it('creates order_items and a pending notification_job atomically with the order', async () => {
    const tenant = await createTenant('NE', 'order-test-7')
    const productId = await createProduct(tenant, { name: 'Gadget', priceSen: 2000 })

    const res = await postPublicOrder('order-test-7', {
      idempotencyKey: 'order-7',
      customer: { name: 'Frank', phone: '0177777777' },
      items: [{ productId, quantity: 2 }],
    })
    const body = await res.json<{ orderId: string }>()

    const items = await db().select().from(orderItems).where(scoped(orderItems, tenant, eq(orderItems.orderId, body.orderId)))
    expect(items).toHaveLength(1)
    expect(items[0].productNameSnapshot).toBe('Gadget')
    expect(items[0].unitPriceSenSnapshot).toBe(2000)
    expect(items[0].quantity).toBe(2)

    const jobs = await db().select().from(notificationJobs).where(scoped(notificationJobs, tenant, eq(notificationJobs.orderId, body.orderId)))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
  })

  it('stores a customer remark with the order', async () => {
    const tenant = await createTenant('NE', 'order-test-remark')
    const productId = await createProduct(tenant, { priceSen: 1200 })

    const res = await postPublicOrder('order-test-remark', {
      idempotencyKey: 'order-remark-1',
      customer: { name: 'Remark Customer', phone: '0178888888' },
      remark: 'Please leave at the front desk',
      items: [{ productId, quantity: 1 }],
    })

    expect(res.status).toBe(201)
    const body = await res.json<{ orderId: string }>()
    const [order] = await db().select().from(orders).where(eq(orders.id, body.orderId)).limit(1)
    expect(order.remark).toBe('Please leave at the front desk')
  })

  it('rejects an order referencing an unavailable product', async () => {
    const tenant = await createTenant('NE', 'order-test-3')
    const productId = await createProduct(tenant, { isAvailable: false })

    const res = await postPublicOrder('order-test-3', {
      idempotencyKey: 'order-3',
      customer: { name: 'Carl', phone: '0133333333' },
      items: [{ productId, quantity: 1 }],
    })

    expect(res.status).toBe(400)
  })

  it('rejects an order referencing a private (non-public) product', async () => {
    const tenant = await createTenant('NE', 'order-test-4')
    const productId = await createProduct(tenant, { isPublic: false })

    const res = await postPublicOrder('order-test-4', {
      idempotencyKey: 'order-4',
      customer: { name: 'Dana', phone: '0144444444' },
      items: [{ productId, quantity: 1 }],
    })

    expect(res.status).toBe(400)
  })

  it('rejects an empty items array', async () => {
    await createTenant('NE', 'order-test-5')

    const res = await postPublicOrder('order-test-5', {
      idempotencyKey: 'order-5',
      customer: { name: 'Eve', phone: '0155555555' },
      items: [],
    })

    expect(res.status).toBe(400)
  })

  it('rejects invalid input (missing customer)', async () => {
    await createTenant('NE', 'order-test-6')

    const res = await postPublicOrder('order-test-6', {
      idempotencyKey: 'order-6',
      items: [{ productId: 'whatever', quantity: 1 }],
    })

    expect(res.status).toBe(400)
  })
})
