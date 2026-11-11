export type ScheduledMealDraft = {
  kind: 'add_on' | 'scheduled_meal' | 'recurring_meal'
  serviceDate?: string
  servicePeriod?: 'lunch' | 'dinner'
  cutoffMalaysiaTime?: string
  weeklyDay?: number
  weeklyCutoffTime?: string
}

export function validateScheduledMealDraft(draft: ScheduledMealDraft): string | null {
  if (draft.kind === 'add_on') return null
  if (draft.kind === 'recurring_meal' ? draft.weeklyDay === undefined : !draft.serviceDate) return draft.kind === 'recurring_meal' ? 'Choose a weekday.' : 'Choose a service date.'
  if (draft.servicePeriod !== 'lunch' && draft.servicePeriod !== 'dinner') return 'Choose lunch or dinner.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.kind === 'recurring_meal' ? draft.weeklyCutoffTime ?? '' : draft.cutoffMalaysiaTime ?? '')) return 'Enter a valid Malaysia cutoff time.'

  return null
}
