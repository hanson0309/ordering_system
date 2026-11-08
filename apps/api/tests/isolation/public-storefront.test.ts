import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { branches, categories, products, regions, tenants } from '../../src/db/schema'
import {
  db,
  createTenant,
  createCategory,
  createProduct,
  createBranch,
  getPublic,
  postPublicOrder,
  SELF,
} from '../helpers'

/**
 * NE/UPM isolation for the unauthenticated public storefront. Nothing here
 * requires a session — the only "identity" is the slug in the URL — so these
 * checks confirm the slug itself can't be used to read or affect another
 * tenant's data.
 */
describe('public storefront isolation', () => {
  it('resolves a store only from its account, region, and store slug tuple', async () => {
    const tenant = await createTenant('Tuple Store', 'tuple-store')
    const mainRegionId = `region_default_${tenant}`
    const pjRegionId = 'tuple-store-pj-region'
    await db().insert(regions).values({ id: pjRegionId, tenantId: tenant, name: 'PJ', slug: 'pj' })
    const firstStore = await createBranch(tenant, 'KK Main', 'kk', false, mainRegionId)
    const secondStore = await createBranch(tenant, 'KK PJ', 'kk', false, pjRegionId)
    const firstProduct = await createProduct(tenant, { name: 'Main menu' })
    const secondProduct = await createProduct(tenant, { name: 'PJ menu' })
    await db().update(products).set({ branchId: firstStore }).where(eq(products.id, firstProduct))
    await db().update(products).set({ branchId: secondStore }).where(eq(products.id, secondProduct))

    const response = await SELF.fetch('https://test.local/api/public/tuple-store/pj/kk/products')
    expect(response.status).toBe(200)
    expect((await response.json<{ products: { name: string }[] }>()).products.map(({ name }) => name)).toEqual(['PJ menu'])
    expect((await SELF.fetch('https://test.local/api/public/tuple-store/unknown/kk/products')).status).toBe(404)
    expect((await SELF.fetch('https://test.local/api/public/tuple-store/kk/products')).status).toBe(404)
  })
  it('does not serve the root or obsolete public API aliases', async () => {
    await createTenant('Root Store', 'root-store')
    expect((await SELF.fetch('https://test.local/api/public/products')).status).toBe(404)
    expect((await SELF.fetch('https://test.local/api/public/root-store/default/products')).status).toBe(404)
  })

  it('product listing for one tenant slug never includes another tenant\'s products', async () => {
    const ne = await createTenant('NE', 'ne-store-1')
    const upm = await createTenant('UPM', 'upm-store-1')
    await createProduct(ne, { name: 'NE Product' })
    await createProduct(upm, { name: 'UPM Product' })

    const neRes = await getPublic('ne-store-1', '/products')
    const neBody = await neRes.json<{ products: { name: string }[] }>()
    expect(neBody.products.map((p) => p.name)).toEqual(['NE Product'])

    const upmRes = await getPublic('upm-store-1', '/products')
    const upmBody = await upmRes.json<{ products: { name: string }[] }>()
    expect(upmBody.products.map((p) => p.name)).toEqual(['UPM Product'])
  })

  it('category listing is scoped per tenant slug', async () => {
    const ne = await createTenant('NE', 'ne-store-2')
    const upm = await createTenant('UPM', 'upm-store-2')
    await createCategory(ne, 'NE Category')
    await createCategory(upm, 'UPM Category')

    const neRes = await getPublic('ne-store-2', '/categories')
    const neBody = await neRes.json<{ categories: { name: string }[] }>()
    expect(neBody.categories.map((c) => c.name)).toEqual(['NE Category'])
  })

  it('an order submitted against one tenant slug referencing another tenant\'s product id is rejected', async () => {
    const ne = await createTenant('NE', 'ne-store-3')
    const upm = await createTenant('UPM', 'upm-store-3')
    const upmProductId = await createProduct(upm, { name: 'UPM Product', priceSen: 500 })

    const res = await postPublicOrder('ne-store-3', {
      idempotencyKey: 'cross-tenant-attempt-1',
      customer: { name: 'Attacker', phone: '0123456789' },
      items: [{ productId: upmProductId, quantity: 1 }],
    })

    expect(res.status).toBe(400)
  })

  it('an unknown slug returns a generic not-found response', async () => {
    const res = await getPublic('this-slug-does-not-exist', '/products')
    expect(res.status).toBe(404)
  })

  it('a suspended tenant\'s slug returns the same generic not-found response as an unknown slug', async () => {
    const suspended = await createTenant('Suspended Co', 'suspended-store-1')
    await db().update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, suspended))

    const res = await getPublic('suspended-store-1', '/products')
    expect(res.status).toBe(404)
  })

  it('private and unavailable products are excluded from the public listing', async () => {
    const ne = await createTenant('NE', 'ne-store-4')
    await createProduct(ne, { name: 'Visible', isPublic: true, isAvailable: true })
    await createProduct(ne, { name: 'Private', isPublic: false, isAvailable: true })
    await createProduct(ne, { name: 'Unavailable', isPublic: true, isAvailable: false })

    const res = await getPublic('ne-store-4', '/products')
    const body = await res.json<{ products: { name: string }[] }>()
    expect(body.products.map((p) => p.name)).toEqual(['Visible'])
  })

  it('serves a location link from a one-time copied menu without mixing locations', async () => {
    const tenant = await createTenant('NE', 'ne-locations-1')
    const defaultBranch = (await db().select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenant)).limit(1))[0].id
    const locationBranch = await createBranch(tenant, 'Bangi', 'bangi')
    const defaultCategory = await createCategory(tenant, 'Default category')
    await db().update(categories).set({ branchId: defaultBranch }).where(eq(categories.id, defaultCategory))
    const defaultProduct = await createProduct(tenant, { name: 'Default menu' })
    await db().update(products).set({ branchId: defaultBranch, categoryId: defaultCategory }).where(eq(products.id, defaultProduct))
    const copiedCategory = 'cat-copy'
    const copiedProduct = 'prod-copy'
    await db().insert(categories).values({ id: copiedCategory, tenantId: tenant, branchId: locationBranch, name: 'Bangi category', sortOrder: 0 })
    await db().insert(products).values({ id: copiedProduct, tenantId: tenant, branchId: locationBranch, categoryId: copiedCategory, name: 'Bangi menu', priceSen: 1200, isPublic: true, isAvailable: true })

    const response = await getPublic('ne-locations-1/main/bangi', '/products')
    const body = await response.json<{ products: { name: string }[] }>()
    expect(response.status).toBe(200)
    expect(body.products.map((product) => product.name)).toEqual(['Bangi menu'])
  })
})
