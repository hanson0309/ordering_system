import { describe, expect, it } from 'vitest'
import { allowedPublicPath } from './_middleware'

describe('Pages public menu paths', () => {
  it('allows account, region, and store menu paths and their checkout pages', () => {
    expect(allowedPublicPath.test('/upmstore/menu/pj/kk')).toBe(true)
    expect(allowedPublicPath.test('/upmstore/menu/pj/kk/cart')).toBe(true)
    expect(allowedPublicPath.test('/upmstore/menu/pj/kk/order/order-123')).toBe(true)
    expect(allowedPublicPath.test('/upmstore/menu/pj/kk/unknown')).toBe(false)
  })

  it('rejects root and obsolete menu path formats', () => {
    expect(allowedPublicPath.test('/')).toBe(false)
    expect(allowedPublicPath.test('/menu/kk')).toBe(false)
    expect(allowedPublicPath.test('/upmstore/menu/kk')).toBe(false)
    expect(allowedPublicPath.test('/upmstore/kk')).toBe(false)
  })
})
