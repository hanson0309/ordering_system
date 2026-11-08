import { describe, expect, it } from 'vitest'
import { selectBranchId } from './branchSelection'

describe('selectBranchId', () => {
  const branches = [
    { id: 'store-a', isDefault: false },
    { id: 'store-b', isDefault: true },
  ]

  it('selects the region default after the region changes', () => {
    expect(selectBranchId(branches, 'store-from-other-region', null)).toBe('store-b')
  })

  it('keeps an explicit selection that belongs to the current region', () => {
    expect(selectBranchId(branches, 'store-a', 'store-a')).toBe('store-a')
  })
})
