import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, TAB_BAR_PATHS } from './routes'

describe('navigation', () => {
  it('has unique paths', () => {
    const paths = NAV_ITEMS.map((i) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('tab bar only references known routes and fits 5 tabs', () => {
    const paths = new Set(NAV_ITEMS.map((i) => i.path))
    expect(TAB_BAR_PATHS.every((p) => paths.has(p))).toBe(true)
    expect(TAB_BAR_PATHS.length).toBeLessThanOrEqual(5)
  })
})
