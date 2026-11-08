export type ScheduledMealDraft = {
  kind: 'add_on' | 'scheduled_meal' | 'recurring_meal'
  serviceDate?: string
  servicePeriod?: 'lunch' | 'dinner'
  cutoffMalaysiaTime?: string
  weeklyDay?: number
  weeklyCutoffTime?: string
  rulePrices: { pricingRuleId: string; priceSen: number }[]
}

type ActivePriceRule = { id: string; isActive: boolean }

export function getRulePriceInputValue(drafts: Record<string, string>, ruleId: string) {
  return drafts[ruleId] ?? ''
}

export function buildRulePrices(kind: ScheduledMealDraft['kind'], drafts: Record<string, string>, rules: ActivePriceRule[]) {
  if (kind === 'add_on') return []
  return rules.filter((rule) => rule.isActive).map((rule) => ({
    pricingRuleId: rule.id,
    priceSen: Math.round(Number(drafts[rule.id] ?? '') * 100),
  }))
}

export function validateScheduledMealDraft(draft: ScheduledMealDraft, rules: ActivePriceRule[]): string | null {
  if (draft.kind === 'add_on') return null
  if (draft.kind === 'recurring_meal' ? draft.weeklyDay === undefined : !draft.serviceDate) return draft.kind === 'recurring_meal' ? 'Choose a weekday.' : 'Choose a service date.'
  if (draft.servicePeriod !== 'lunch' && draft.servicePeriod !== 'dinner') return 'Choose lunch or dinner.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.kind === 'recurring_meal' ? draft.weeklyCutoffTime ?? '' : draft.cutoffMalaysiaTime ?? '')) return 'Enter a valid Malaysia cutoff time.'

  const prices = new Map(draft.rulePrices.map((price) => [price.pricingRuleId, price.priceSen]))
  if (rules.filter((rule) => rule.isActive).some((rule) => !Number.isInteger(prices.get(rule.id)) || prices.get(rule.id)! < 0)) {
    return 'Set a price for every active price rule.'
  }
  return null
}
