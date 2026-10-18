import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { accountTelegramSettings, auditLogs, branches, categories, customers, notificationJobs, orderItems, orders, products, tenantSettings, users } from '../src/db/schema'
import { newId } from '../src/lib/id'
import { processDueNotifications } from '../src/services/notifications'
import { getAnalyticsRange, getMalaysiaDayStart } from '../src/routes/dashboard'
import type { Env } from '../src/types'
import {
  SELF,
  addMembership,
  createCustomer,
  createProduct,
  createTenant,
  createUser,
  db,
  loginAndGetCookie,
  postPublicOrder,
  switchOrganization,
  env,
} from './helpers'

describe('tenant dashboard', () => {
  it('calculates the dashboard day boundary in Malaysia time', () => {
    expect(getMalaysiaDayStart(new Date('2026-10-17T01:30:00.000Z')).toISOString()).toBe('2026-10-16T16:00:00.000Z')
    expect(getMalaysiaDayStart(new Date('2026-10-17T16:00:00.000Z')).toISOString()).toBe('2026-10-17T16:00:00.000Z')
  })

  it('builds Malaysia-time analytics ranges for today, week, and month', () => {
    const now = new Date('2026-10-17T01:30:00.000Z')
    expect(getAnalyticsRange('today', now)).toMatchObject({
      start: new Date('2026-10-16T16:00:00.000Z'),
      granularity: 'hour',
    })
    expect(getAnalyticsRange('week', now)).toMatchObject({
      start: new Date('2026-10-11T16:00:00.000Z'),
      granularity: 'day',
    })
    expect(getAnalyticsRange('month', now)).toMatchObject({
      start: new Date('2026-09-30T16:00:00.000Z'),
      granularity: 'day',
    })
  })

  it('returns monthly KPI, trend, and top-product analytics', async () => {
    const tenant = await createTenant('Analytics Store', 'dashboard-analytics')
    const customer = await createCustomer(tenant, 'Analytics Customer')
    const recentOrderId = newId('order')
    const olderOrderId = newId('order')
    const now = Date.now()
    await db().insert(orders).values([
      { id: recentOrderId, tenantId: tenant, customerId: customer, orderNumber: 'ANALYTICS-1', totalSen: 1200, idempotencyKey: newId('idem'), createdAt: new Date(now - 60 * 60 * 1000) },
      { id: olderOrderId, tenantId: tenant, customerId: customer, orderNumber: 'ANALYTICS-2', totalSen: 800, idempotencyKey: newId('idem'), createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000) },
    ])
    await db().insert(orderItems).values({ id: newId('item'), tenantId: tenant, orderId: recentOrderId, productNameSnapshot: 'Tea', unitPriceSenSnapshot: 600, quantity: 2 })
    await db().insert(orderItems).values({ id: newId('item'), tenantId: tenant, orderId: olderOrderId, productNameSnapshot: 'Coffee', unitPriceSenSnapshot: 800, quantity: 1 })
    const user = await createUser('dashboard-analytics@example.com')
    await addMembership(user, tenant, 'owner')
    const cookie = await loginAndGetCookie('dashboard-analytics@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/summary?period=month', { headers: { cookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      period: 'month',
      orderCount: 1,
      totalSen: 1200,
      averageOrderValueSen: 1200,
      topProducts: [{ name: 'Tea', quantity: 2, totalSen: 1200 }],
    })
  })

  it('lets an owner create an independent store with its own public link and design', async () => {
    const originalTenant = await createTenant('Original', 'stores-original')
    const user = await createUser('dashboard-create-store@example.com')
    await addMembership(user, originalTenant, 'owner')
    const cookie = await loginAndGetCookie('dashboard-create-store@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/stores', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'UPM Cafe', slug: 'upm-cafe', design: 'midnight', tagline: 'Fresh every day' }),
    })
    expect(response.status).toBe(201)
    const body = await response.json<{ organization: { tenantId: string; slug: string; role: string } }>()
    expect(body.organization.slug).toBe('upm-cafe')
    expect(body.organization.role).toBe('owner')

    const publicStore = await SELF.fetch('https://test.local/api/public/upm-cafe')
    expect(publicStore.status).toBe(200)
    await expect(publicStore.json()).resolves.toMatchObject({ name: 'UPM Cafe', slug: 'upm-cafe', businessInfo: { design: 'midnight', tagline: 'Fresh every day' } })

    const organizations = await SELF.fetch('https://test.local/api/me/organizations', { headers: { cookie } })
    const organizationBody = await organizations.json<{ organizations: { slug: string }[] }>()
    expect(organizationBody.organizations.map((organization) => organization.slug)).toEqual(expect.arrayContaining(['stores-original', 'upm-cafe']))
  })

  it('does not let a non-owner create another store', async () => {
    const tenant = await createTenant('Staff Store', 'stores-staff')
    const user = await createUser('dashboard-create-store-staff@example.com')
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('dashboard-create-store-staff@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/stores', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Blocked', slug: 'stores-blocked', design: 'clean' }),
    })
    expect(response.status).toBe(403)
  })

  it('allows an owner to change the public store name and slug', async () => {
    const tenant = await createTenant('Old Name', 'old-store-name')
    const user = await createUser('dashboard-settings-name@example.com')
    await addMembership(user, tenant, 'owner')
    const cookie = await loginAndGetCookie('dashboard-settings-name@example.com')

    const update = await SELF.fetch('https://test.local/api/dashboard/settings', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'UPM', slug: 'upm-custom', orderListSendTime: '18:30' }),
    })
    expect(update.status).toBe(200)

    const settings = await SELF.fetch('https://test.local/api/dashboard/settings', { headers: { cookie } })
    await expect(settings.json()).resolves.toMatchObject({ settings: { orderListSendTime: '18:30' } })

    const store = await SELF.fetch('https://test.local/api/public/upm-custom')
    expect(store.status).toBe(200)
    await expect(store.json()).resolves.toMatchObject({ name: 'UPM', slug: 'upm-custom' })

    const oldStore = await SELF.fetch('https://test.local/api/public/old-store-name')
    expect(oldStore.status).toBe(404)
  })

  it('rejects a public slug already used by another organization', async () => {
    const first = await createTenant('First', 'settings-slug-first')
    const second = await createTenant('Second', 'settings-slug-second')
    const user = await createUser('dashboard-settings-slug@example.com')
    await addMembership(user, second, 'owner')
    const cookie = await loginAndGetCookie('dashboard-settings-slug@example.com')

    const update = await SELF.fetch('https://test.local/api/dashboard/settings', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'settings-slug-first' }),
    })
    expect(update.status).toBe(409)
    expect(await update.json()).toEqual({ error: 'slug_taken' })
    expect(first).toBeTruthy()
  })

  it('rejects unauthenticated dashboard access', async () => {
    const response = await SELF.fetch('https://test.local/api/dashboard/orders')
    expect(response.status).toBe(401)
  })

  it('blocks tenant owners from changing the global Telegram configuration', async () => {
    const tenant = await createTenant('Telegram Store', 'telegram-global-protection')
    const user = await createUser('telegram-tenant-owner@example.com')
    await addMembership(user, tenant, 'owner')
    const cookie = await loginAndGetCookie('telegram-tenant-owner@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/telegram-settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ botToken: 'secret-token', chatId: '123456' }),
    })

    expect(response.status).toBe(403)
  })

  it('lets a platform admin save an account-specific encrypted Telegram configuration without returning the token', async () => {
    const user = await createUser('telegram-configured-account@example.com')
    const tenant = await createTenant('Telegram Platform Store', 'telegram-platform-settings', user)
    const platformUser = await createUser('telegram-platform-admin@example.com')
    await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, platformUser))
    const platformTenant = await createTenant('Platform Admin Store', 'telegram-platform-admin-store')
    await addMembership(platformUser, platformTenant, 'owner')
    const cookie = await loginAndGetCookie('telegram-platform-admin@example.com')
    const testEnv = env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }
    const previousKey = testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY
    testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key'
    let fetchSpy: ReturnType<typeof vi.spyOn> | undefined

    try {
      const save = await SELF.fetch('https://test.local/api/dashboard/telegram-settings', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ accountUserId: user, botToken: 'sensitive-bot-token', chatId: '-100123456' }),
      })
      expect(save.status).toBe(200)
      expect(await save.json()).toEqual({ configured: true, chatId: '-100123456' })

      const [stored] = await db().select().from(accountTelegramSettings).where(eq(accountTelegramSettings.accountUserId, user))
      expect(stored.value).not.toContain('sensitive-bot-token')

      const read = await SELF.fetch(`https://test.local/api/dashboard/telegram-settings?accountUserId=${user}`, { headers: { cookie } })
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({ configured: true, chatId: '-100123456' })

      const product = await createProduct(tenant)
      const createdOrder = await postPublicOrder('telegram-platform-settings', {
        idempotencyKey: 'telegram-shared-config-order',
        customer: { name: 'Telegram Customer', phone: '0165555555' },
        items: [{ productId: product, quantity: 1 }],
      })
      expect(createdOrder.status).toBe(201)
      await db().insert(tenantSettings).values({ tenantId: tenant, orderListSendTime: '00:00' })

      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      const testMessage = await SELF.fetch('https://test.local/api/dashboard/telegram-settings/test', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: user }) })
      expect(testMessage.status).toBe(200)
      expect(await testMessage.json()).toEqual({ sent: true })
      expect(fetchSpy).toHaveBeenCalledWith('https://api.telegram.org/botsensitive-bot-token/sendMessage', expect.objectContaining({ method: 'POST' }))
      const messageBody = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)) as { chat_id: string; text: string }
      expect(messageBody).toEqual({ chat_id: '-100123456', text: 'Telegram connection test successful.' })
      await processDueNotifications(env as unknown as Env, 1000)
      expect(fetchSpy).toHaveBeenCalledWith('https://api.telegram.org/botsensitive-bot-token/sendDocument', expect.objectContaining({ method: 'POST' }))
    } finally {
      fetchSpy?.mockRestore()
      if (previousKey === undefined) delete testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY
      else testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY = previousKey
    }
  })

  it('keeps Telegram settings isolated between dashboard accounts', async () => {
    const firstAccount = await createUser('telegram-isolation-first@example.com')
    const secondAccount = await createUser('telegram-isolation-second@example.com')
    const platformUser = await createUser('telegram-isolation-platform@example.com')
    await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, platformUser))
    const platformTenant = await createTenant('Telegram Isolation Platform Store', 'telegram-isolation-platform')
    await addMembership(platformUser, platformTenant, 'owner')
    const cookie = await loginAndGetCookie('telegram-isolation-platform@example.com')
    const testEnv = env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }
    const previousKey = testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY
    testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      for (const [accountUserId, botToken, chatId] of [
        [firstAccount, 'first-account-token', 'first-chat'],
        [secondAccount, 'second-account-token', 'second-chat'],
      ]) {
        const response = await SELF.fetch('https://test.local/api/dashboard/telegram-settings', {
          method: 'PUT',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ accountUserId, botToken, chatId }),
        })
        expect(response.status).toBe(200)
      }

      const firstRead = await SELF.fetch(`https://test.local/api/dashboard/telegram-settings?accountUserId=${firstAccount}`, { headers: { cookie } })
      const secondRead = await SELF.fetch(`https://test.local/api/dashboard/telegram-settings?accountUserId=${secondAccount}`, { headers: { cookie } })
      await expect(firstRead.json()).resolves.toEqual({ configured: true, chatId: 'first-chat' })
      await expect(secondRead.json()).resolves.toEqual({ configured: true, chatId: 'second-chat' })

      const firstStored = await db().select().from(accountTelegramSettings).where(eq(accountTelegramSettings.accountUserId, firstAccount))
      const secondStored = await db().select().from(accountTelegramSettings).where(eq(accountTelegramSettings.accountUserId, secondAccount))
      expect(firstStored).toHaveLength(1)
      expect(secondStored).toHaveLength(1)
      expect(firstStored[0].value).not.toBe(secondStored[0].value)
    } finally {
      if (previousKey === undefined) delete testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY
      else testEnv.TELEGRAM_SETTINGS_ENCRYPTION_KEY = previousKey
    }
  })

  it('lists only the active tenant orders and blocks cross-tenant product mutation', async () => {
    const ne = await createTenant('NE', 'dashboard-ne-1')
    const upm = await createTenant('UPM', 'dashboard-upm-1')
    const neProduct = await createProduct(ne, { name: 'NE Product' })
    await createProduct(upm, { name: 'UPM Product' })
    await postPublicOrder('dashboard-ne-1', {
      idempotencyKey: 'dashboard-ne-order-1',
      customer: { name: 'NE Customer', phone: '0161111111' },
      items: [{ productId: neProduct, quantity: 1 }],
    })

    const user = await createUser('dashboard-owner-1@example.com')
    await addMembership(user, ne, 'owner')
    const cookie = await loginAndGetCookie('dashboard-owner-1@example.com')

    const ordersResponse = await SELF.fetch('https://test.local/api/dashboard/orders', { headers: { cookie } })
    const ordersBody = await ordersResponse.json<{ orders: { customerName: string }[] }>()
    expect(ordersResponse.status).toBe(200)
    expect(ordersBody.orders.map((order) => order.customerName)).toEqual(['NE Customer'])

    const crossTenantPatch = await SELF.fetch(`https://test.local/api/dashboard/products/${await createProduct(upm)}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'tampered' }),
    })
    expect(crossTenantPatch.status).toBe(404)

    const forbiddenSwitch = await switchOrganization(cookie, upm)
    expect(forbiddenSwitch.res.status).toBe(403)
  })

  it('enforces role permissions and records an authorized status change', async () => {
    const tenant = await createTenant('NE', 'dashboard-role-1')
    const product = await createProduct(tenant, { priceSen: 2500 })
    const orderResponse = await postPublicOrder('dashboard-role-1', {
      idempotencyKey: 'dashboard-role-order-1',
      customer: { name: 'Role Customer', phone: '0162222222' },
      items: [{ productId: product, quantity: 1 }],
    })
    const { orderId } = await orderResponse.json<{ orderId: string }>()

    const viewer = await createUser('dashboard-viewer-1@example.com')
    await addMembership(viewer, tenant, 'viewer')
    const viewerCookie = await loginAndGetCookie('dashboard-viewer-1@example.com')
    const viewerMutation = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { cookie: viewerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    })
    expect(viewerMutation.status).toBe(403)

    const owner = await createUser('dashboard-owner-2@example.com')
    await addMembership(owner, tenant, 'owner')
    const ownerCookie = await loginAndGetCookie('dashboard-owner-2@example.com')
    const mutation = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    })
    expect(mutation.status).toBe(200)

    const [savedOrder] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1)
    expect(savedOrder.status).toBe('confirmed')
    const audit = await db().select().from(auditLogs).where(eq(auditLogs.targetId, orderId))
    expect(audit).toHaveLength(1)
    expect(audit[0].tenantId).toBe(tenant)
  })

  it('keeps settings and product creation inside the active tenant', async () => {
    const ne = await createTenant('NE', 'dashboard-settings-ne')
    const upm = await createTenant('UPM', 'dashboard-settings-upm')
    const user = await createUser('dashboard-admin-1@example.com')
    await addMembership(user, ne, 'admin')
    const cookie = await loginAndGetCookie('dashboard-admin-1@example.com')

    const productResponse = await SELF.fetch('https://test.local/api/dashboard/products', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NE New Product', priceSen: 900, categoryId: null }),
    })
    expect(productResponse.status).toBe(201)

    const settingsResponse = await SELF.fetch('https://test.local/api/dashboard/settings', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ businessInfo: { tagline: 'Telegram orders' } }),
    })
    expect(settingsResponse.status).toBe(200)

    const switchResponse = await switchOrganization(cookie, upm)
    expect(switchResponse.res.status).toBe(403)
  })

  it('allows an admin to edit an existing menu product', async () => {
    const tenant = await createTenant('NE', 'dashboard-edit-product')
    const productId = await createProduct(tenant, { name: 'Old name', priceSen: 900 })
    const user = await createUser('dashboard-edit-product@example.com')
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('dashboard-edit-product@example.com')

    const response = await SELF.fetch(`https://test.local/api/dashboard/products/${productId}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New name', priceSen: 1250, imageUrl: null, isAvailable: false }),
    })

    expect(response.status).toBe(200)
    const [product] = await db().select().from(products).where(eq(products.id, productId)).limit(1)
    expect(product.name).toBe('New name')
    expect(product.priceSen).toBe(1250)
    expect(product.isAvailable).toBe(false)
  })

  it('creates a location with a one-time copy of the default menu', async () => {
    const tenant = await createTenant('NE', 'dashboard-location-copy')
    const defaultBranch = await db().insert(branches).values({ id: 'branch-default-copy', tenantId: tenant, name: 'Default', slug: 'default', isDefault: true }).returning({ id: branches.id })
    const categoryId = 'cat-default-copy'
    await db().insert(categories).values({ id: categoryId, tenantId: tenant, branchId: defaultBranch[0].id, name: 'Drinks', sortOrder: 0 })
    await db().insert(products).values({ id: 'prod-default-copy', tenantId: tenant, branchId: defaultBranch[0].id, categoryId, name: 'Tea', priceSen: 500, isPublic: true, isAvailable: true })
    const user = await createUser('dashboard-location-copy@example.com')
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('dashboard-location-copy@example.com')

    const response = await SELF.fetch('https://test.local/api/dashboard/branches', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bangi', slug: 'bangi', syncDefault: true, makeDefault: false }),
    })
    expect(response.status).toBe(201)
    const body = await response.json<{ branch: { id: string } }>()
    const copied = await db().select().from(products).where(eq(products.branchId, body.branch.id))
    expect(copied.map((product) => product.name)).toEqual(['Tea'])
  })

  it('keeps order detail actions inside the selected location', async () => {
    const tenant = await createTenant('NE', 'dashboard-location-order-isolation')
    const [firstBranch] = await db().insert(branches).values({ id: 'branch-order-a', tenantId: tenant, name: 'A', slug: 'a', isDefault: true }).returning({ id: branches.id })
    const [secondBranch] = await db().insert(branches).values({ id: 'branch-order-b', tenantId: tenant, name: 'B', slug: 'b', isDefault: false }).returning({ id: branches.id })
    const customerId = await createCustomer(tenant, 'Location Customer')
    const orderId = newId('order')
    await db().insert(orders).values({
      id: orderId,
      tenantId: tenant,
      branchId: secondBranch.id,
      customerId,
      orderNumber: 'LOC-ORDER-B',
      totalSen: 1000,
      idempotencyKey: newId('idem'),
    })
    await db().insert(notificationJobs).values({
      id: newId('job'),
      tenantId: tenant,
      orderId,
      idempotencyKey: newId('notify'),
    })

    const user = await createUser('dashboard-location-order-isolation@example.com')
    await addMembership(user, tenant, 'staff')
    const cookie = await loginAndGetCookie('dashboard-location-order-isolation@example.com')
    const query = `?branchId=${firstBranch.id}`

    const detail = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}${query}`, { headers: { cookie } })
    expect(detail.status).toBe(404)

    const status = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/status${query}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    })
    expect(status.status).toBe(404)

    const pdf = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/pdf${query}`, { headers: { cookie } })
    expect(pdf.status).toBe(404)

    const retry = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/notification/retry${query}`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(retry.status).toBe(404)
  })

  it('generates a private PDF only for an authorized tenant order', async () => {
    const ne = await createTenant('NE', 'dashboard-pdf-ne')
    const upm = await createTenant('UPM', 'dashboard-pdf-upm')
    const product = await createProduct(ne, { name: 'PDF Product', priceSen: 1200 })
    const orderResponse = await postPublicOrder('dashboard-pdf-ne', {
      idempotencyKey: 'dashboard-pdf-order-1',
      customer: { name: 'PDF Customer', phone: '0163333333' },
      items: [{ productId: product, quantity: 2 }],
    })
    const { orderId } = await orderResponse.json<{ orderId: string }>()

    const owner = await createUser('dashboard-pdf-owner@example.com')
    await addMembership(owner, ne, 'staff')
    const cookie = await loginAndGetCookie('dashboard-pdf-owner@example.com')
    const pdfResponse = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/pdf`, { headers: { cookie } })
    const pdf = new Uint8Array(await pdfResponse.arrayBuffer())
    expect(pdfResponse.status).toBe(200)
    expect(pdfResponse.headers.get('content-type')).toContain('application/pdf')
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF')

    const otherUser = await createUser('dashboard-pdf-other@example.com')
    await addMembership(otherUser, upm, 'owner')
    const otherCookie = await loginAndGetCookie('dashboard-pdf-other@example.com')
    const forbiddenPdf = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/pdf`, { headers: { cookie: otherCookie } })
    expect(forbiddenPdf.status).toBe(404)
  })

  it('sends queued order PDFs to the configured Telegram chat without changing the saved order', async () => {
    const user = await createUser('dashboard-notify-owner@example.com')
    const tenant = await createTenant('NE', 'dashboard-notify-offline', user)
    const product = await createProduct(tenant, { priceSen: 800 })
    const response = await postPublicOrder('dashboard-notify-offline', {
      idempotencyKey: 'dashboard-notify-offline-order',
      customer: { name: 'Offline Customer', phone: '0164444444' },
      items: [{ productId: product, quantity: 1 }],
    })
    const { orderId } = await response.json<{ orderId: string }>()
    await db().insert(tenantSettings).values({ tenantId: tenant, orderListSendTime: '00:00' })

    const previousKey = (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY
    ;(env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key'
    const cryptoAdmin = await createUser('dashboard-notify-platform@example.com')
    await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, cryptoAdmin))
    const platformTenant = await createTenant('Notification Platform Admin Store', 'dashboard-notify-platform-store')
    await addMembership(cryptoAdmin, platformTenant, 'owner')
    const cookie = await loginAndGetCookie('dashboard-notify-platform@example.com')
    const save = await SELF.fetch('https://test.local/api/dashboard/telegram-settings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: user, botToken: 'test-token', chatId: '123456' }) })
    expect(save.status).toBe(200)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await processDueNotifications(env as unknown as Env, 1000)
    await processDueNotifications(env as unknown as Env, 1000)
    const [job] = await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, orderId)).limit(1)
    const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1)
    expect(job.status).toBe('sent')
    expect(fetchSpy).toHaveBeenCalledWith('https://api.telegram.org/bottest-token/sendDocument', expect.objectContaining({ method: 'POST' }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit
    const form = request.body as FormData
    expect(form.get('chat_id')).toBe('123456')
    expect((form.get('document') as File).name).toMatch(/^order-list-.+\.pdf$/)
    expect(order.totalSen).toBe(800)
    expect(order.status).toBe('pending')
    fetchSpy.mockRestore()
    if (previousKey === undefined) delete (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY
    else (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY = previousKey
  })

  it('lets an admin manually send pending orders without consuming the scheduled digest', async () => {
    const user = await createUser('manual-digest-admin@example.com')
    const tenant = await createTenant('Manual Digest Store', 'manual-digest-store', user)
    const product = await createProduct(tenant, { priceSen: 1250 })
    const created = await postPublicOrder('manual-digest-store', {
      idempotencyKey: 'manual-digest-order',
      customer: { name: 'Manual Customer', phone: '0167777777' },
      items: [{ productId: product, quantity: 2 }],
    })
    const { orderId } = await created.json<{ orderId: string }>()
    await db().insert(tenantSettings).values({ tenantId: tenant, orderListSendTime: '23:00', orderListLastSentDate: '2099-01-01' })
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('manual-digest-admin@example.com')
    const previousKey = (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY
    ;(env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key'
    const platformUser = await createUser('manual-digest-platform@example.com')
    await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, platformUser))
    const platformTenant = await createTenant('Manual Digest Platform Admin Store', 'manual-digest-platform-store')
    await addMembership(platformUser, platformTenant, 'owner')
    const platformCookie = await loginAndGetCookie('manual-digest-platform@example.com')
    const save = await SELF.fetch('https://test.local/api/dashboard/telegram-settings', { method: 'PUT', headers: { cookie: platformCookie, 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: user, botToken: 'test-token', chatId: '123456' }) })
    expect(save.status).toBe(200)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const response = await SELF.fetch('https://test.local/api/dashboard/orders/order-list/send-now', { method: 'POST', headers: { cookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ sent: true, orderCount: 1 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sentFile = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as FormData
    expect((sentFile.get('document') as File).name).toMatch(/^order-list-.+\.pdf$/)
    const [job] = await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, orderId)).limit(1)
    const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1)
    const [settings] = await db().select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant)).limit(1)
    expect(job.status).toBe('sent')
    expect(order.status).toBe('pending')
    expect(settings.orderListLastSentDate).toBe('2099-01-01')

    const empty = await SELF.fetch('https://test.local/api/dashboard/orders/order-list/send-now', { method: 'POST', headers: { cookie } })
    expect(empty.status).toBe(409)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
    if (previousKey === undefined) delete (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY
    else (env as unknown as { TELEGRAM_SETTINGS_ENCRYPTION_KEY: string }).TELEGRAM_SETTINGS_ENCRYPTION_KEY = previousKey
  })

  it('reports missing Telegram configuration when an admin manually sends the order list', async () => {
    const tenant = await createTenant('Unconfigured Digest Store', 'unconfigured-digest-store')
    const product = await createProduct(tenant, { priceSen: 900 })
    await postPublicOrder('unconfigured-digest-store', {
      idempotencyKey: 'unconfigured-digest-order',
      customer: { name: 'Unconfigured Customer', phone: '0168888888' },
      items: [{ productId: product, quantity: 1 }],
    })
    const user = await createUser('unconfigured-digest-admin@example.com')
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('unconfigured-digest-admin@example.com')
    const previousToken = (env as unknown as { TELEGRAM_BOT_TOKEN?: string }).TELEGRAM_BOT_TOKEN
    const previousChatId = (env as unknown as { TELEGRAM_CHAT_ID?: string }).TELEGRAM_CHAT_ID
    delete (env as unknown as { TELEGRAM_BOT_TOKEN?: string }).TELEGRAM_BOT_TOKEN
    delete (env as unknown as { TELEGRAM_CHAT_ID?: string }).TELEGRAM_CHAT_ID

    const response = await SELF.fetch('https://test.local/api/dashboard/orders/order-list/send-now', { method: 'POST', headers: { cookie } })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'telegram_not_configured' })

    if (previousToken === undefined) delete (env as unknown as { TELEGRAM_BOT_TOKEN?: string }).TELEGRAM_BOT_TOKEN
    else (env as unknown as { TELEGRAM_BOT_TOKEN: string }).TELEGRAM_BOT_TOKEN = previousToken
    if (previousChatId === undefined) delete (env as unknown as { TELEGRAM_CHAT_ID?: string }).TELEGRAM_CHAT_ID
    else (env as unknown as { TELEGRAM_CHAT_ID: string }).TELEGRAM_CHAT_ID = previousChatId
  })

  it('records unconfigured Telegram jobs without using legacy Worker credentials', async () => {
    const tenant = await createTenant('Unconfigured Scheduled Store', 'unconfigured-scheduled-store')
    const product = await createProduct(tenant, { priceSen: 500 })
    const created = await postPublicOrder('unconfigured-scheduled-store', {
      idempotencyKey: 'unconfigured-scheduled-order',
      customer: { name: 'Unconfigured Scheduled Customer', phone: '0169999999' },
      items: [{ productId: product, quantity: 1 }],
    })
    const { orderId } = await created.json<{ orderId: string }>()
    await db().insert(tenantSettings).values({ tenantId: tenant, orderListSendTime: '00:00' })
    const testEnv = env as unknown as { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string }
    const previousToken = testEnv.TELEGRAM_BOT_TOKEN
    const previousChatId = testEnv.TELEGRAM_CHAT_ID
    testEnv.TELEGRAM_BOT_TOKEN = 'legacy-global-token'
    testEnv.TELEGRAM_CHAT_ID = 'legacy-global-chat'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      await processDueNotifications(env as unknown as Env, 1000)
      const [job] = await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, orderId)).limit(1)
      expect(job.status).toBe('pending')
      expect(job.errorCategory).toBe('telegram_not_configured')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      if (previousToken === undefined) delete testEnv.TELEGRAM_BOT_TOKEN
      else testEnv.TELEGRAM_BOT_TOKEN = previousToken
      if (previousChatId === undefined) delete testEnv.TELEGRAM_CHAT_ID
      else testEnv.TELEGRAM_CHAT_ID = previousChatId
    }
  })
})
