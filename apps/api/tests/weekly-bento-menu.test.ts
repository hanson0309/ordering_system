import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  branches,
  orderItems,
  pricingRules,
  products,
  scheduledMealPrices,
} from '../src/db/schema'
import { newId } from '../src/lib/id'
import {
  expandWeeklyMealDates,
  getMalaysiaDate,
  isScheduledMealOpen,
  malaysiaWeekday,
  parseMalaysiaCutoff,
  resolveEffectiveProductPrices,
} from '../src/services/scheduled-meals'
import { createOrder as createPublicOrder } from '../src/services/orders'
import { SELF, addMembership, createCustomer, createOrder, createProduct, createTenant, createUser, db, getPublic, loginAndGetCookie } from './helpers'

describe('weekly bento menu schema', () => {
  it('persists tenant pricing rules and a location assignment', async () => {
    const tenantId = await createTenant('Bento rules', 'bento-rules')
    const productId = await createProduct(tenantId, { name: 'Monday lunch' })
    const [branch] = await db()
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.tenantId, tenantId))
      .limit(1)

    const studentRuleId = newId('price-rule')
    const deliveryRuleId = newId('price-rule')
    await db().insert(pricingRules).values([
      { id: studentRuleId, tenantId, name: 'UPM Student', sortOrder: 0 },
      { id: deliveryRuleId, tenantId, name: 'Klang Valley Delivery', sortOrder: 1 },
    ])
    await db().update(branches).set({ pricingRuleId: studentRuleId }).where(eq(branches.id, branch.id))
    await db().insert(scheduledMealPrices).values({
      id: newId('scheduled-price'),
      tenantId,
      productId,
      pricingRuleId: studentRuleId,
      priceSen: 850,
    })

    expect(await db().select().from(pricingRules).where(eq(pricingRules.tenantId, tenantId))).toHaveLength(2)
    await expect(db().insert(scheduledMealPrices).values({
      id: newId('scheduled-price'),
      tenantId,
      productId,
      pricingRuleId: studentRuleId,
      priceSen: 900,
    })).rejects.toThrow()
  })

  it('keeps ordinary legacy products and order items without schedule snapshots', async () => {
    const tenantId = await createTenant('Legacy bento', 'legacy-bento')
    const customerId = await createCustomer(tenantId)
    const orderId = await createOrder(tenantId, customerId, 'LEGACY-BENTO-1')
    const productId = await createProduct(tenantId, { name: 'Coke', priceSen: 300 })
    const itemId = newId('item')

    await db().insert(orderItems).values({
      id: itemId,
      tenantId,
      orderId,
      productNameSnapshot: 'Coke',
      unitPriceSenSnapshot: 300,
      quantity: 1,
    })

    expect(await db().select({ serviceDate: products.serviceDate }).from(products).where(eq(products.id, productId))).toEqual([
      { serviceDate: null },
    ])
    const [weekly] = await db().select({ weeklyDay: products.weeklyDay, weeklyCutoffTime: products.weeklyCutoffTime }).from(products).where(eq(products.id, productId))
    expect(weekly).toEqual({ weeklyDay: null, weeklyCutoffTime: null })
    expect(await db().select().from(orderItems).where(eq(orderItems.id, itemId))).toMatchObject([
      { serviceDateSnapshot: null, servicePeriodSnapshot: null, pricingRuleNameSnapshot: null },
    ])

  })

  it('keeps new locations without a delivery-period restriction by default', async () => {
    const tenantId = await createTenant('Default delivery period', 'default-delivery-period')
    const [branch] = await db().select({ deliveryPeriod: branches.deliveryPeriod }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    expect(branch.deliveryPeriod).toBeNull()
  })
})

describe('scheduled meal pricing', () => {
  it('expands a weekday template to the matching Malaysia-local dates only', () => {
    expect(getMalaysiaDate(new Date('2026-10-26T16:30:00.000Z'))).toBe('2026-10-27')
    expect(malaysiaWeekday('2026-10-26')).toBe(1)
    expect(expandWeeklyMealDates({ weekday: 1, fromDate: '2026-10-27', days: 14 })).toEqual([
      '2026-11-02', '2026-11-09',
    ])
  })

  it('converts Malaysia cutoff time to UTC and closes at the exact instant', () => {
    const cutoff = parseMalaysiaCutoff('2026-10-29', '09:00')
    expect(cutoff.toISOString()).toBe('2026-10-29T01:00:00.000Z')
    const meal = {
      serviceDate: '2026-10-29',
      servicePeriod: 'lunch' as const,
      orderCutoffAt: cutoff,
      isPublic: true,
      isAvailable: true,
    }
    expect(isScheduledMealOpen(meal, new Date('2026-10-29T00:59:59.000Z'))).toBe(true)
    expect(isScheduledMealOpen(meal, new Date('2026-10-29T01:00:00.000Z'))).toBe(false)
  })

  it('adds the selected location rule adjustment to the scheduled meal base price', async () => {
    const tenantId = await createTenant('Location pricing', 'location-pricing')
    const productId = await createProduct(tenantId, { name: 'Wednesday lunch', priceSen: 1000 })
    const [studentBranch] = await db().select().from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    const deliveryBranchId = newId('branch')
    await db().insert(branches).values({
      id: deliveryBranchId,
      tenantId,
      regionId: studentBranch.regionId,
      name: 'Delivery',
      slug: 'delivery',
    })
    const studentRuleId = newId('price-rule')
    const deliveryRuleId = newId('price-rule')
    await db().insert(pricingRules).values([
      { id: studentRuleId, tenantId, name: 'UPM Student', sortOrder: 0 },
      { id: deliveryRuleId, tenantId, name: 'Klang Valley Delivery', sortOrder: 1 },
    ])
    await db().update(branches).set({ pricingRuleId: studentRuleId }).where(eq(branches.id, studentBranch.id))
    await db().update(branches).set({ pricingRuleId: deliveryRuleId }).where(eq(branches.id, deliveryBranchId))
    await db().update(products).set({
      serviceDate: '2026-10-29',
      servicePeriod: 'lunch',
      orderCutoffAt: new Date('2026-10-30T01:00:00.000Z'),
    }).where(eq(products.id, productId))
    await db().insert(scheduledMealPrices).values([
      { id: newId('scheduled-price'), tenantId, productId, pricingRuleId: studentRuleId, priceSen: 0 },
      { id: newId('scheduled-price'), tenantId, productId, pricingRuleId: deliveryRuleId, priceSen: 500 },
    ])

    const [meal] = await db().select().from(products).where(eq(products.id, productId))
    await expect(resolveEffectiveProductPrices(db(), tenantId, studentBranch.id, [meal], new Date('2026-10-29T00:00:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ id: productId, effectivePriceSen: 1000, pricingRuleName: 'UPM Student' }),
    ])
    await expect(resolveEffectiveProductPrices(db(), tenantId, deliveryBranchId, [meal], new Date('2026-10-29T00:00:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ id: productId, effectivePriceSen: 1500, pricingRuleName: 'Klang Valley Delivery' }),
    ])
  })

  it('snapshots scheduled pricing and service data when the order is created', async () => {
    const tenantId = await createTenant('Snapshot pricing', 'snapshot-pricing')
    const productId = await createProduct(tenantId, { name: 'Thursday lunch', priceSen: 1000 })
    const [branch] = await db().select().from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    const ruleId = newId('price-rule')
    await db().insert(pricingRules).values({ id: ruleId, tenantId, name: 'UPM Student', sortOrder: 0 })
    await db().update(branches).set({ pricingRuleId: ruleId }).where(eq(branches.id, branch.id))
    await db().update(products).set({
      serviceDate: '2026-10-29',
      servicePeriod: 'lunch',
      orderCutoffAt: new Date('2026-10-29T01:00:00.000Z'),
    }).where(eq(products.id, productId))
    await db().insert(scheduledMealPrices).values({
      id: newId('scheduled-price'),
      tenantId,
      productId,
      pricingRuleId: ruleId,
      priceSen: 850,
    })

    const order = await createPublicOrder(db(), tenantId, {
      idempotencyKey: 'snapshot-pricing-1',
      customer: { name: 'Snapshot customer', phone: '0180000001' },
      items: [{ productId, quantity: 2 }],
    }, branch.id, new Date('2026-10-29T00:00:00.000Z'))

    expect(order.totalSen).toBe(3700)
    expect(await db().select().from(orderItems).where(eq(orderItems.orderId, order.id))).toMatchObject([
      {
        productNameSnapshot: 'Thursday lunch',
        unitPriceSenSnapshot: 1850,
        serviceDateSnapshot: '2026-10-29',
        servicePeriodSnapshot: 'lunch',
        pricingRuleNameSnapshot: 'UPM Student',
      },
    ])
  })

  it('validates a recurring meal occurrence and snapshots the selected date', async () => {
    const tenantId = await createTenant('Recurring bento', 'recurring-bento')
    const productId = await createProduct(tenantId, { name: 'Sesame chicken rice', priceSen: 850 })
    const [branch] = await db().select().from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    const ruleId = newId('price-rule')
    await db().insert(pricingRules).values({ id: ruleId, tenantId, name: 'UPM Student', sortOrder: 0 })
    await db().update(branches).set({ pricingRuleId: ruleId, deliveryPeriod: 'lunch' }).where(eq(branches.id, branch.id))
    await db().update(products).set({ servicePeriod: 'lunch', weeklyDay: 3, weeklyCutoffTime: '09:00' }).where(eq(products.id, productId))
    await db().insert(scheduledMealPrices).values({ id: newId('scheduled-price'), tenantId, productId, pricingRuleId: ruleId, priceSen: 0 })

    const order = await createPublicOrder(db(), tenantId, {
      idempotencyKey: 'recurring-meal-order', customer: { name: 'Weekly customer', phone: '0180000002' },
      items: [{ productId, quantity: 1, serviceDate: '2026-10-28' }],
    }, branch.id, new Date('2026-10-28T00:00:00.000Z'))
    expect(order.totalSen).toBe(850)
    expect(await db().select().from(orderItems).where(eq(orderItems.orderId, order.id))).toMatchObject([
      { serviceDateSnapshot: '2026-10-28', servicePeriodSnapshot: 'lunch', pricingRuleNameSnapshot: 'UPM Student' },
    ])

    await expect(createPublicOrder(db(), tenantId, {
      idempotencyKey: 'recurring-meal-wrong-weekday', customer: { name: 'Weekly customer', phone: '0180000002' },
      items: [{ productId, quantity: 1, serviceDate: '2026-10-29' }],
    }, branch.id, new Date('2026-10-28T00:00:00.000Z'))).rejects.toThrow()

    await expect(createPublicOrder(db(), tenantId, {
      idempotencyKey: 'recurring-meal-future-date', customer: { name: 'Weekly customer', phone: '0180000002' },
      items: [{ productId, quantity: 1, serviceDate: '2026-11-04' }],
    }, branch.id, new Date('2026-10-28T00:00:00.000Z'))).rejects.toThrow()
  })

  it('returns only the current Malaysia date for a weekly meal storefront', async () => {
    const tenantId = await createTenant('Today only bento', 'today-only-bento')
    const productId = await createProduct(tenantId, { name: 'Today only meal', priceSen: 850 })
    const [branch] = await db().select().from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    const ruleId = newId('price-rule')
    await db().insert(pricingRules).values({ id: ruleId, tenantId, name: 'UPM Student', sortOrder: 0 })
    await db().update(branches).set({ pricingRuleId: ruleId }).where(eq(branches.id, branch.id))
    const today = getMalaysiaDate(new Date())
    await db().update(products).set({
      servicePeriod: 'lunch',
      weeklyDay: malaysiaWeekday(today),
      weeklyCutoffTime: '23:59',
    }).where(eq(products.id, productId))
    await db().insert(scheduledMealPrices).values({ id: newId('scheduled-price'), tenantId, productId, pricingRuleId: ruleId, priceSen: 0 })

    const response = await getPublic('today-only-bento', '/products')
    expect(response.status).toBe(200)
    const body = await response.json<{ products: Array<{ id: string; serviceDate: string | null }> }>()
    expect(body.products.filter((product) => product.id === productId)).toEqual([
      expect.objectContaining({ id: productId, serviceDate: today }),
    ])
  })

  it('hides future one-time meals and rejects future dated orders', async () => {
    const tenantId = await createTenant('Today only one-time bento', 'today-only-one-time-bento')
    const productId = await createProduct(tenantId, { name: 'Future one-time meal', priceSen: 850 })
    const [branch] = await db().select().from(branches).where(eq(branches.tenantId, tenantId)).limit(1)
    const ruleId = newId('price-rule')
    await db().insert(pricingRules).values({ id: ruleId, tenantId, name: 'UPM Student', sortOrder: 0 })
    await db().update(branches).set({ pricingRuleId: ruleId }).where(eq(branches.id, branch.id))
    await db().update(products).set({
      serviceDate: '2099-01-01',
      servicePeriod: 'lunch',
      orderCutoffAt: new Date('2099-01-01T15:59:00.000Z'),
    }).where(eq(products.id, productId))
    await db().insert(scheduledMealPrices).values({ id: newId('scheduled-price'), tenantId, productId, pricingRuleId: ruleId, priceSen: 0 })

    const response = await getPublic('today-only-one-time-bento', '/products')
    expect(response.status).toBe(200)
    const body = await response.json<{ products: Array<{ id: string }> }>()
    expect(body.products.some((product) => product.id === productId)).toBe(false)

    await expect(createPublicOrder(db(), tenantId, {
      idempotencyKey: 'future-one-time-order', customer: { name: 'Future customer', phone: '0180000003' },
      items: [{ productId, quantity: 1 }],
    }, branch.id, new Date('2026-10-30T00:00:00.000Z'))).rejects.toThrow()
  })
})

describe('scheduled meal dashboard API', () => {
  it('creates an add-on when schedule form fields are empty', async () => {
    const tenantId = await createTenant('Dashboard add-on', 'dashboard-add-on')
    const userId = await createUser('dashboard-add-on@example.com')
    await addMembership(userId, tenantId, 'admin')
    const cookie = await loginAndGetCookie('dashboard-add-on@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/products', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '100plus', priceSen: 400, categoryId: null, isPublic: true, isAvailable: true,
        kind: 'add_on', serviceDate: '', servicePeriod: 'lunch', cutoffMalaysiaTime: '09:00', rulePrices: [],
      }),
    })

    expect(response.status).toBe(201)
  })

  it('creates a scheduled meal with its Malaysia cutoff and location rule price', async () => {
    const tenantId = await createTenant('Dashboard bento', 'dashboard-bento')
    const userId = await createUser('dashboard-bento@example.com')
    await addMembership(userId, tenantId, 'admin')
    const cookie = await loginAndGetCookie('dashboard-bento@example.com')
    const [branch] = await db().select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).limit(1)

    const createdRule = await SELF.fetch('https://test.local/api/dashboard/pricing-rules', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'UPM Student' }),
    })
    const { pricingRule } = await createdRule.json<{ pricingRule: { id: string } }>()
    await SELF.fetch(`https://test.local/api/dashboard/branches/${branch.id}/pricing-rule`, {
      method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ pricingRuleId: pricingRule.id }),
    })

    const createdMeal = await SELF.fetch(`https://test.local/api/dashboard/products?branchId=${branch.id}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Thai mayo dory rice', priceSen: 1000, categoryId: null, isPublic: true, isAvailable: true,
        kind: 'scheduled_meal', serviceDate: '2026-10-29', servicePeriod: 'lunch', cutoffMalaysiaTime: '09:00',
        rulePrices: [{ pricingRuleId: pricingRule.id, priceSen: 850 }],
      }),
    })

    expect(createdMeal.status).toBe(201)
    const { product } = await createdMeal.json<{ product: { id: string; serviceDate: string; servicePeriod: string; orderCutoffAt: string } }>()
    expect(product).toMatchObject({ serviceDate: '2026-10-29', servicePeriod: 'lunch' })
    expect(new Date(product.orderCutoffAt).toISOString()).toBe('2026-10-29T01:00:00.000Z')
    expect(await db().select().from(scheduledMealPrices).where(eq(scheduledMealPrices.productId, product.id))).toMatchObject([
      { pricingRuleId: pricingRule.id, priceSen: 850 },
    ])
  })
})
