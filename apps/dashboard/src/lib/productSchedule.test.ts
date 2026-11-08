import { describe, expect, it } from 'vitest'
import { formatMalaysiaTime, getProductKind } from './productSchedule'

describe('product schedule helpers', () => {
  it('classifies add-ons, one-time meals, and weekly meals', () => {
    expect(getProductKind({ serviceDate: null, servicePeriod: null, orderCutoffAt: null, weeklyDay: null, weeklyCutoffTime: null })).toBe('add_on')
    expect(getProductKind({ serviceDate: '2026-10-30', servicePeriod: 'lunch', orderCutoffAt: '2026-10-30T01:00:00.000Z', weeklyDay: null, weeklyCutoffTime: null })).toBe('scheduled_meal')
    expect(getProductKind({ serviceDate: null, servicePeriod: 'dinner', orderCutoffAt: null, weeklyDay: 5, weeklyCutoffTime: '13:00' })).toBe('recurring_meal')
  })

  it('formats a cutoff in Malaysia time for editing', () => {
    expect(formatMalaysiaTime('2026-10-30T01:00:00.000Z')).toBe('09:00')
  })
})
