import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { branches, regions } from '../../src/db/schema'
import { createBranch, createTenant, db, env } from '../helpers'

describe('region migration', () => {
  it('assigns existing stores to a default region for each account', async () => {
    const firstTenantId = await createTenant('First Account', 'region-migration-first')
    const secondTenantId = await createTenant('Second Account', 'region-migration-second')

    const firstRegions = await db().select().from(regions).where(eq(regions.tenantId, firstTenantId))
    const secondRegions = await db().select().from(regions).where(eq(regions.tenantId, secondTenantId))
    const firstBranches = await db().select().from(branches).where(eq(branches.tenantId, firstTenantId))
    const secondBranches = await db().select().from(branches).where(eq(branches.tenantId, secondTenantId))

    expect(firstRegions).toHaveLength(1)
    expect(secondRegions).toHaveLength(1)
    expect(firstRegions[0].isDefault).toBe(true)
    expect(firstBranches.every((branch) => branch.regionId === firstRegions[0].id)).toBe(true)
    expect(secondBranches.every((branch) => branch.regionId === secondRegions[0].id)).toBe(true)
    expect(firstRegions[0].id).not.toBe(secondRegions[0].id)
  })

  it('enforces region ownership at the database boundary', async () => {
    const tenantId = await createTenant('Null Region Guard', 'region-null-guard')
    await expect(env.DB.prepare(
      'INSERT INTO branches (id, tenant_id, name, slug, is_default, region_id) VALUES (?, ?, ?, ?, 0, NULL)',
    ).bind('branch-without-region', tenantId, 'No region', 'no-region').run()).rejects.toThrow(/region_id is required/)
  })

  it('allows identical store slugs in different regions but not in the same region', async () => {
    const tenantId = await createTenant('Slug Account', 'region-migration-slugs')
    const firstRegionId = (await db().select({ id: regions.id }).from(regions).where(eq(regions.tenantId, tenantId)).get())!.id
    const secondRegionId = 'region-second-test'
    await db().insert(regions).values({ id: secondRegionId, tenantId, name: 'Second', slug: 'second' })

    await createBranch(tenantId, 'First KK', 'kk', false, firstRegionId)
    await createBranch(tenantId, 'Second KK', 'kk', false, secondRegionId)

    await expect(createBranch(tenantId, 'Duplicate KK', 'kk', false, firstRegionId)).rejects.toThrow()
    const matchingBranches = await db().select().from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.slug, 'kk')))
    expect(matchingBranches).toHaveLength(2)
  })
})
