import { describe, expect, it } from 'vitest'
import { buildLocationLink } from './locationLink'

describe('buildLocationLink', () => {
  it('builds an absolute public link from the current origin', () => {
    expect(buildLocationLink('upm', 'putrajaya', 'https://dashboard.example')).toBe('https://dashboard.example/upm/putrajaya')
  })
})
