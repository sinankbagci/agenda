import { describe, expect, it } from 'vitest'
import { gaps, intersect, subtract, subtractFrom, totalLength, union } from './ranges'

const r = (start: number, end: number) => ({ start, end })

describe('ranges', () => {
  it('union merges overlapping and touching ranges, drops empty ones', () => {
    expect(union([r(50, 60), r(0, 10), r(10, 20), r(15, 30), r(40, 40)])).toEqual([r(0, 30), r(50, 60)])
  })

  it('subtractFrom cuts holes and keeps extra fields', () => {
    expect(subtractFrom({ start: 0, end: 100, energy: 'high' }, [r(20, 30), r(25, 40), r(90, 120)])).toEqual([
      { start: 0, end: 20, energy: 'high' },
      { start: 40, end: 90, energy: 'high' },
    ])
    expect(subtractFrom(r(10, 20), [r(0, 30)])).toEqual([])
    expect(subtractFrom(r(10, 20), [r(20, 30)])).toEqual([r(10, 20)]) // touching doesn't cut
  })

  it('subtract works over many ranges and sorts', () => {
    expect(subtract([r(50, 80), r(0, 30)], [r(10, 60)])).toEqual([r(0, 10), r(60, 80)])
  })

  it('intersect clips to the allowed ranges', () => {
    expect(intersect([{ start: 0, end: 100, id: 'a' }], [r(10, 20), r(15, 30), r(90, 200)])).toEqual([
      { start: 10, end: 30, id: 'a' },
      { start: 90, end: 100, id: 'a' },
    ])
  })

  it('gaps and totals', () => {
    expect(gaps([r(0, 480), r(900, 960)])).toEqual([r(480, 900), r(960, 1440)])
    expect(totalLength([r(0, 30), r(60, 75)])).toBe(45)
  })
})
