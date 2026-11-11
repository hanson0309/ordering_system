import { describe, expect, it } from 'vitest'
import { buildLocationLink } from './locationLink'

describe('buildLocationLink', () => {
  it('uses the account, region, and store slugs', () => {
    expect(buildLocationLink('upmstore', 'pj', 'kk', 'https://dashboard.example')).toBe('https://dashboard.example/upmstore/menu/pj/kk')
  })

  it('distinguishes the same store slug in separate regions', () => {
    expect(buildLocationLink('upmstore', 'kk', 'kk', 'https://dashboard.example')).not.toBe(buildLocationLink('upmstore', 'pj', 'kk', 'https://dashboard.example'))
  })

  it('points local dashboard links at the local storefront server', () => {
    expect(buildLocationLink('upm', 'gg', 'w12', 'http://127.0.0.1:5174')).toBe('http://127.0.0.1:5175/upm/menu/gg/w12')
  })

  it('keeps the shared origin for deployed storefront links', () => {
    expect(buildLocationLink('upm', 'gg', 'w12', 'https://ordering.example')).toBe('https://ordering.example/upm/menu/gg/w12')
  })
})
