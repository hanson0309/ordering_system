import { describe, expect, it } from 'vitest'
import { groupProductsForMenu } from './menuGrouping'

describe('groupProductsForMenu', () => {
  it('groups scheduled meals by date and service period before add-ons', () => {
    const groups = groupProductsForMenu([
      { id: 'coke', name: 'Coke', serviceDate: null, servicePeriod: null },
      { id: 'thu-lunch', name: 'Thursday lunch', serviceDate: '2025-10-30', servicePeriod: 'lunch' },
      { id: 'wed-dinner', name: 'Wednesday dinner', serviceDate: '2025-10-29', servicePeriod: 'dinner' },
      { id: 'wed-lunch', name: 'Wednesday lunch', serviceDate: '2025-10-29', servicePeriod: 'lunch' },
    ])

    expect(groups.map((group) => group.label)).toEqual([
      'Wed, 29 Oct · Lunch',
      'Wed, 29 Oct · Dinner',
      'Thu, 30 Oct · Lunch',
      'Add-ons',
    ])
    expect(groups.map((group) => group.products.map((product) => product.id))).toEqual([
      ['wed-lunch'],
      ['wed-dinner'],
      ['thu-lunch'],
      ['coke'],
    ])
  })
})
