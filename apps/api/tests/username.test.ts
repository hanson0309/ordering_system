import { describe, expect, it } from 'vitest'
import { normalizeUsername } from '../src/auth/username'

describe('username normalization', () => {
  it('normalizes a valid username and rejects invalid values', () => {
    expect(normalizeUsername(' Store_Admin ')).toBe('store_admin')
    expect(normalizeUsername('ab')).toBeNull()
    expect(normalizeUsername('bad@email')).toBeNull()
  })
})
