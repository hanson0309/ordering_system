import { describe, expect, it } from 'vitest'
import type { D1Migration } from '@cloudflare/vitest-plugin'
import { eq } from 'drizzle-orm'
import { customers, memberships, sessions, systemSettings, tenants } from '../../src/db/schema'
import { newId } from '../../src/lib/id'
import { createUser, db, env } from '../helpers'

describe('account isolation migration', () => {
  it('moves ordinary legacy members into distinct tenants without deleting their existing data', async () => {
    const legacyTenantId = 'tenant_hanson'
    const firstUserId = await createUser('migration-first@example.com')
    const secondUserId = await createUser('migration-second@example.com')
    await db().insert(memberships).values([
      { id: newId('mem'), userId: firstUserId, tenantId: legacyTenantId, role: 'staff' },
      { id: newId('mem'), userId: secondUserId, tenantId: legacyTenantId, role: 'viewer' },
    ])
    await db().insert(customers).values({
      id: 'migration-legacy-customer',
      tenantId: legacyTenantId,
      name: 'Legacy customer',
      phone: '0100000000',
    })
    await db().insert(sessions).values([
      { id: newId('sess'), tokenHash: 'migration-session-first', userId: firstUserId, activeTenantId: legacyTenantId, expiresAt: new Date(Date.now() + 60_000) },
      { id: newId('sess'), tokenHash: 'migration-session-second', userId: secondUserId, activeTenantId: legacyTenantId, expiresAt: new Date(Date.now() + 60_000) },
    ])

    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
    const migration = migrations.find(({ name }) => name.includes('0010_isolate_dashboard_accounts'))
    expect(migration).toBeDefined()
    for (const query of migration!.queries) await env.DB.prepare(query).run()

    const firstMemberships = await db().select().from(memberships).where(eq(memberships.userId, firstUserId))
    const secondMemberships = await db().select().from(memberships).where(eq(memberships.userId, secondUserId))
    expect(firstMemberships).toHaveLength(1)
    expect(secondMemberships).toHaveLength(1)
    expect(firstMemberships[0].tenantId).not.toBe(legacyTenantId)
    expect(secondMemberships[0].tenantId).not.toBe(legacyTenantId)
    expect(firstMemberships[0].tenantId).not.toBe(secondMemberships[0].tenantId)
    expect(firstMemberships[0].role).toBe('staff')
    expect(secondMemberships[0].role).toBe('viewer')

    const firstTenant = await db().select().from(tenants).where(eq(tenants.id, firstMemberships[0].tenantId))
    expect(firstTenant).toHaveLength(1)
    expect(await db().select().from(customers).where(eq(customers.id, 'migration-legacy-customer'))).toHaveLength(1)

    const activeSessions = await db().select().from(sessions).where(eq(sessions.userId, firstUserId))
    expect(activeSessions[0].activeTenantId).toBe(firstMemberships[0].tenantId)

    for (const query of migration!.queries) await env.DB.prepare(query).run()
    expect(await db().select().from(memberships).where(eq(memberships.userId, firstUserId))).toHaveLength(1)
    expect(await db().select().from(memberships).where(eq(memberships.userId, secondUserId))).toHaveLength(1)
  })

  it('backfills an unambiguous tenant owner and removes only the legacy Telegram system setting', async () => {
    const owner = await createUser('migration-telegram-owner@example.com')
    const tenantId = 'migration-telegram-owner-tenant'
    await db().insert(tenants).values({ id: tenantId, name: 'Owned tenant', slug: 'migration-telegram-owned' })
    await db().insert(memberships).values({ id: newId('mem'), userId: owner, tenantId, role: 'owner' })
    await db().insert(systemSettings).values([
      { key: 'telegram', value: 'legacy encrypted value' },
      { key: 'unrelated', value: 'keep me' },
    ])

    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
    const migration = migrations.find(({ name }) => name.includes('0011_account_telegram_settings'))
    expect(migration).toBeDefined()
    const ownerBackfill = migration!.queries.find((query) => query.includes("`m`.`role` = 'owner'") && query.includes('UPDATE `tenants`'))
    const legacyCleanup = migration!.queries.find((query) => query.includes("DELETE FROM `system_settings` WHERE `key` = 'telegram'"))
    expect(ownerBackfill).toBeDefined()
    expect(legacyCleanup).toBeDefined()
    await env.DB.prepare(ownerBackfill!).run()
    await env.DB.prepare(legacyCleanup!).run()

    const [savedTenant] = await db().select().from(tenants).where(eq(tenants.id, tenantId))
    expect(savedTenant.accountUserId).toBe(owner)
    const remainingSettings = await db().select().from(systemSettings)
    expect(remainingSettings).toMatchObject([{ key: 'unrelated', value: 'keep me' }])
  })
})
