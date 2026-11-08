import { describe, expect, it } from 'vitest'
import { buildRulePrices, getRulePriceInputValue, validateScheduledMealDraft } from './pricingRules'

const activeRules = [
  { id: 'upm', isActive: true },
  { id: 'delivery', isActive: true },
]

describe('validateScheduledMealDraft', () => {
  it('leaves an unentered price adjustment blank in the form', () => {
    expect(getRulePriceInputValue({}, 'upm')).toBe('')
  })

  it('treats blank price adjustments as zero while preserving entered amounts', () => {
    expect(buildRulePrices('scheduled_meal', { upm: '8.5' }, activeRules)).toEqual([
      { pricingRuleId: 'upm', priceSen: 850 },
      { pricingRuleId: 'delivery', priceSen: 0 },
    ])
  })

  it('does not include rule prices when creating an ordinary add-on', () => {
    expect(buildRulePrices('add_on', {}, activeRules)).toEqual([])
  })

  it('requires scheduled meal details and a price for every active rule', () => {
    expect(validateScheduledMealDraft({
      kind: 'scheduled_meal',
      serviceDate: '',
      servicePeriod: 'lunch',
      cutoffMalaysiaTime: '09:00',
      rulePrices: [],
    }, activeRules)).toBe('Choose a service date.')

    expect(validateScheduledMealDraft({
      kind: 'scheduled_meal',
      serviceDate: '2026-10-29',
      servicePeriod: 'lunch',
      cutoffMalaysiaTime: '09:00',
      rulePrices: [{ pricingRuleId: 'upm', priceSen: 0 }],
    }, activeRules)).toBe('Set a price for every active price rule.')
  })

  it('accepts add-ons and a complete scheduled-meal price grid', () => {
    expect(validateScheduledMealDraft({ kind: 'add_on', rulePrices: [] }, activeRules)).toBeNull()
    expect(validateScheduledMealDraft({
      kind: 'scheduled_meal',
      serviceDate: '2026-10-29',
      servicePeriod: 'dinner',
      cutoffMalaysiaTime: '13:00',
      rulePrices: [
        { pricingRuleId: 'upm', priceSen: 850 },
        { pricingRuleId: 'delivery', priceSen: 1500 },
      ],
    }, activeRules)).toBeNull()
  })
})
