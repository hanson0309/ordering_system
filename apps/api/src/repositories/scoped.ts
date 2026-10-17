import { and, eq, type SQL } from 'drizzle-orm'
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'

/**
 * Every tenant-owned table has a `tenantId` column. This helper combines
 * that column's equality check with any additional predicate, so route and
 * repository code can never construct a query that reads/writes a table
 * without the tenant filter attached.
 *
 * Usage: db.select().from(orders).where(scoped(orders, tenantId, eq(orders.id, orderId)))
 */
export function scoped<T extends { tenantId: SQLiteTableWithColumns<any>['tenantId'] }>(
  table: T,
  tenantId: string,
  extra?: SQL | undefined,
): SQL {
  const tenantPredicate = eq((table as any).tenantId, tenantId)
  return extra ? and(tenantPredicate, extra)! : tenantPredicate
}
