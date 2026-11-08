import { describe, expect, it } from 'vitest'
import { buildStoreCreationInput, groupStoresByRegion } from './storeManagement'

describe('groupStoresByRegion', () => {
  it('keeps stores under their own region and marks only the selected region active', () => {
    const regions = [
      { id: 'region-a', tenantId: 'tenant', name: '区域 A', slug: 'a', isDefault: true },
      { id: 'region-b', tenantId: 'tenant', name: '区域 B', slug: 'b', isDefault: false },
    ]
    const branches = [
      { id: 'store-a', regionId: 'region-a', name: '店铺 A', slug: 'store-a', address: null, isDefault: true, hasPaymentQr: false },
      { id: 'store-b', regionId: 'region-b', name: '店铺 B', slug: 'store-b', address: null, isDefault: false, hasPaymentQr: false },
    ]

    expect(groupStoresByRegion(regions, branches, 'region-b')).toEqual([
      { region: regions[0], stores: [branches[0]], isActive: false },
      { region: regions[1], stores: [branches[1]], isActive: true },
    ])
  })
})

describe('buildStoreCreationInput', () => {
  it('binds a new store to the region card where it was created', () => {
    expect(buildStoreCreationInput('region-a', '店铺 A', 'store-a', true, false)).toEqual({
      regionId: 'region-a',
      name: '店铺 A',
      slug: 'store-a',
      syncDefault: true,
      makeDefault: false,
    })
  })
})
