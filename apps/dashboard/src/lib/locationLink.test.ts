import { describe, expect, it } from 'vitest'
import { buildLocationLink } from './locationLink'

describe('buildLocationLink', () => {
  it('uses the account, region, and store slugs', () => {
    expect(buildLocationLink('upmstore', 'pj', 'kk', 'https://dashboard.example')).toBe('https://dashboard.example/upmstore/menu/pj/kk')
  })

  it('distinguishes the same store slug in separate regions', () => {
    expect(buildLocationLink('upmstore', 'kk', 'kk', 'https://dashboard.example')).not.toBe(buildLocationLink('upmstore', 'pj', 'kk', 'https://dashboard.example'))
  })
})
