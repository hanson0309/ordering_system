import { describe, expect, it } from 'vitest'
import { getPublicStorePath, getStoreUrlBase } from './storePath'

describe('menu location paths', () => {
  it('uses account, region, and store slugs for public API requests', () => {
    expect(getPublicStorePath('upmstore', 'pj', 'kk')).toBe('upmstore/pj/kk')
  })

  it('keeps the account, menu, region, and store path segments in navigation links', () => {
    expect(getStoreUrlBase('upmstore', 'pj', 'kk')).toBe('/upmstore/menu/pj/kk')
  })

  it('distinguishes identical store slugs belonging to different regions', () => {
    expect(getStoreUrlBase('upmstore', 'pj', 'kk')).not.toBe(getStoreUrlBase('upmstore', 'kk', 'kk'))
  })

  it('does not produce a storefront URL without all hierarchy slugs', () => {
    expect(getStoreUrlBase()).toBe('')
    expect(getStoreUrlBase('upmstore')).toBe('')
    expect(getStoreUrlBase('upmstore', 'pj')).toBe('')
  })
})
