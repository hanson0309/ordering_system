import { describe, expect, it } from 'vitest'
import { validateScheduledMealDraft } from './pricingRules'

describe('validateScheduledMealDraft', () => {
  it('requires scheduled meal details without requiring per-meal rule prices', () => {
    expect(validateScheduledMealDraft({
      kind: 'scheduled_meal',
      serviceDate: '',
      servicePeriod: 'lunch',
      cutoffMalaysiaTime: '09:00',
    })).toBe('Choose a service date.')
  })

  it('accepts add-ons and scheduled meals with a base price only', () => {
    expect(validateScheduledMealDraft({ kind: 'add_on' })).toBeNull()
    expect(validateScheduledMealDraft({
      kind: 'scheduled_meal',
      serviceDate: '2026-10-29',
      servicePeriod: 'dinner',
      cutoffMalaysiaTime: '13:00',
    })).toBeNull()
  })
})
