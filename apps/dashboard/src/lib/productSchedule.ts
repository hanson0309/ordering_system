export type ProductKind = 'add_on' | 'scheduled_meal' | 'recurring_meal'

export type ProductScheduleShape = {
  serviceDate: string | null
  servicePeriod: 'lunch' | 'dinner' | null
  orderCutoffAt: string | null
  weeklyDay: number | null
  weeklyCutoffTime: string | null
}

export function getProductKind(product: ProductScheduleShape): ProductKind {
  if (product.weeklyDay !== null || product.weeklyCutoffTime !== null) return 'recurring_meal'
  if (product.serviceDate !== null || product.servicePeriod !== null || product.orderCutoffAt !== null) return 'scheduled_meal'
  return 'add_on'
}

export function formatMalaysiaTime(isoDate: string | null): string {
  if (!isoDate) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoDate))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.hour ?? ''}:${values.minute ?? ''}`
}
