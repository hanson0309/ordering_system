import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { orders, customers } from '../../src/db/schema'
import { scoped } from '../../src/repositories/scoped'
import { db, createTenant, createCustomer, createOrder } from '../helpers'

/**
 * Verifies the `scoped()` helper — the structural mechanism every
 * route/repository must use — actually prevents cross-tenant reads at the
 * query level, independent of any route-level auth check.
 */
describe('scoped query helper', () => {
  it('NE can list its own orders; UPM orders are excluded', async () => {
    const ne = await createTenant('NE', 'ne-data-1')
    const upm = await createTenant('UPM', 'upm-data-1')
    const neCustomer = await createCustomer(ne, 'NE Customer')
    const upmCustomer = await createCustomer(upm, 'UPM Customer')
    await createOrder(ne, neCustomer, 'NE-0001')
    await createOrder(upm, upmCustomer, 'UPM-0001')

    const neOrders = await db().select().from(orders).where(scoped(orders, ne))
    const upmOrders = await db().select().from(orders).where(scoped(orders, upm))

    expect(neOrders).toHaveLength(1)
    expect(neOrders[0].orderNumber).toBe('NE-0001')
    expect(upmOrders).toHaveLength(1)
    expect(upmOrders[0].orderNumber).toBe('UPM-0001')
  })

  it('fetching a UPM order by ID under the NE tenant scope returns nothing', async () => {
    const ne = await createTenant('NE', 'ne-data-2')
    const upm = await createTenant('UPM', 'upm-data-2')
    const upmCustomer = await createCustomer(upm, 'UPM Customer')
    const upmOrderId = await createOrder(upm, upmCustomer, 'UPM-0002')

    // Simulates an NE-authorized request where the client tampered with the
    // order ID in the URL to point at a known UPM order.
    const result = await db()
      .select()
      .from(orders)
      .where(scoped(orders, ne, eq(orders.id, upmOrderId)))

    expect(result).toHaveLength(0)
  })

  it('tenant-scoped customer lookups never cross tenants', async () => {
    const ne = await createTenant('NE', 'ne-data-3')
    const upm = await createTenant('UPM', 'upm-data-3')
    await createCustomer(ne, 'NE Customer A')
    await createCustomer(ne, 'NE Customer B')
    await createCustomer(upm, 'UPM Customer A')

    const neCustomers = await db().select().from(customers).where(scoped(customers, ne))
    const upmCustomers = await db().select().from(customers).where(scoped(customers, upm))

    expect(neCustomers).toHaveLength(2)
    expect(upmCustomers).toHaveLength(1)
    expect(neCustomers.every((c) => c.tenantId === ne)).toBe(true)
    expect(upmCustomers.every((c) => c.tenantId === upm)).toBe(true)
  })

  it('order counts (dashboard-style aggregates) do not leak across tenants', async () => {
    const ne = await createTenant('NE', 'ne-data-4')
    const upm = await createTenant('UPM', 'upm-data-4')
    const neCustomer = await createCustomer(ne, 'NE Customer')
    const upmCustomer = await createCustomer(upm, 'UPM Customer')
    await createOrder(ne, neCustomer, 'NE-0004-A')
    await createOrder(ne, neCustomer, 'NE-0004-B')
    await createOrder(upm, upmCustomer, 'UPM-0004-A')

    const neCount = (await db().select().from(orders).where(scoped(orders, ne))).length
    const upmCount = (await db().select().from(orders).where(scoped(orders, upm))).length

    expect(neCount).toBe(2)
    expect(upmCount).toBe(1)
  })
})
