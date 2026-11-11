import { and, eq } from 'drizzle-orm'
import { branches, pricingRules } from '../db/schema'
import type { Db } from '../db/client'

export type ServicePeriod = 'lunch' | 'dinner'

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

export function expandWeeklyMealDates({ weekday, fromDate, days }: { weekday: number; fromDate: string; days: number }): string[] {
  const start = parseIsoDate(fromDate)
  if (!start || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(days) || days <= 0) return []
  const dates: string[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000)
    if (date.getUTCDay() === weekday) dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

export function malaysiaWeekday(serviceDate: string): number {
  const date = parseIsoDate(serviceDate)
  if (!date) throw new Error('invalid_service_date')
  return date.getUTCDay()
}

export function getMalaysiaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

type ScheduleFields = {
  serviceDate: string | null
  servicePeriod: ServicePeriod | null
  orderCutoffAt: Date | null
  weeklyDay?: number | null
  weeklyCutoffTime?: string | null
  isPublic: boolean
  isAvailable: boolean
}

export function parseMalaysiaCutoff(serviceDate: string, cutoff: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) {
    throw new Error('invalid_malaysia_cutoff')
  }
  const parsed = new Date(`${serviceDate}T${cutoff}:00+08:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid_malaysia_cutoff')
  return parsed
}

export function isScheduledMeal(product: Pick<ScheduleFields, 'serviceDate' | 'servicePeriod' | 'orderCutoffAt' | 'weeklyDay' | 'weeklyCutoffTime'>): boolean {
  return product.serviceDate !== null || product.servicePeriod !== null || product.orderCutoffAt !== null || isWeeklyMeal(product)
}

export function isWeeklyMeal(product: Pick<ScheduleFields, 'weeklyDay' | 'weeklyCutoffTime'>): boolean {
  return product.weeklyDay != null || product.weeklyCutoffTime != null
}

export function isScheduledMealOpen(product: ScheduleFields, now = new Date()): boolean {
  return Boolean(
    product.isPublic
    && product.isAvailable
    && product.serviceDate
    && product.servicePeriod
    && product.orderCutoffAt
    && now < product.orderCutoffAt,
  )
}

export async function getBranchPricingRule(db: Db, tenantId: string, branchId: string) {
  const [rule] = await db
    .select({ id: pricingRules.id, name: pricingRules.name, deliveryFeeSen: pricingRules.deliveryFeeSen })
    .from(branches)
    .innerJoin(
      pricingRules,
      and(
        eq(pricingRules.id, branches.pricingRuleId),
        eq(pricingRules.tenantId, tenantId),
        eq(pricingRules.isActive, true),
      ),
    )
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
    .limit(1)
  return rule ?? null
}

export async function resolveEffectiveProductPrices<T extends ScheduleFields & { id: string; priceSen: number }>(
  db: Db,
  tenantId: string,
  branchId: string,
  productRows: T[],
  now = new Date(),
): Promise<Array<T & { effectivePriceSen: number; pricingRuleName: string; deliveryFeeSen: number }>> {
  if (productRows.length === 0) return []

  const rule = await getBranchPricingRule(db, tenantId, branchId)
  if (!rule) return []

  return productRows.flatMap((product) => {
    return isScheduledMealOpen(product, now)
      ? [{ ...product, effectivePriceSen: product.priceSen, pricingRuleName: rule.name, deliveryFeeSen: rule.deliveryFeeSen }]
      : []
  })
}

export function expandWeeklyProduct<T extends ScheduleFields & { id: string }>(product: T, fromDate: string, days = 14) {
  if (product.weeklyDay == null || !product.weeklyCutoffTime || !product.servicePeriod) return []
  return expandWeeklyMealDates({ weekday: product.weeklyDay, fromDate, days }).map((serviceDate) => ({
    ...product,
    serviceDate,
    orderCutoffAt: parseMalaysiaCutoff(serviceDate, product.weeklyCutoffTime!),
  }))
}
