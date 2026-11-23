import { describe, expect, it } from 'vitest'
import {
  findOverlappingWindows,
  validateFixedBlock,
  validateLimits,
  validateMeal,
  validateOverride,
  validateRule,
  validateSleep,
  validateWindow,
  weeklyAvailableMinutes,
} from './setupValidation'
import { DEFAULT_SETTINGS } from '../db/defaults'
import type { AvailabilityWindow, FixedBlock } from '../db/types'

const ok = { errors: [], warnings: [] }

describe('validateSleep', () => {
  it('accepts normal and over-midnight sleep', () => {
    expect(validateSleep({ sleepStart: '00:00', sleepEnd: '08:00' })).toEqual(ok)
    expect(validateSleep({ sleepStart: '23:00', sleepEnd: '07:00' })).toEqual(ok)
  })
  it('rejects identical or missing times', () => {
    expect(validateSleep({ sleepStart: '07:00', sleepEnd: '07:00' }).errors).toHaveLength(1)
    expect(validateSleep({ sleepStart: '', sleepEnd: '07:00' }).errors).toHaveLength(1)
  })
  it('warns about very short or long sleep', () => {
    expect(validateSleep({ sleepStart: '03:00', sleepEnd: '06:00' }).warnings[0]).toMatch(/only 3h/)
    expect(validateSleep({ sleepStart: '20:00', sleepEnd: '10:00' }).warnings[0]).toMatch(/14h/)
  })
})

describe('validateFixedBlock', () => {
  const classes: Omit<FixedBlock, 'id'> = {
    title: 'Classes',
    rule: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] },
    start: '09:00',
    end: '15:00',
    locked: true,
  }
  it('accepts the acceptance-scenario classes', () => expect(validateFixedBlock(classes)).toEqual(ok))
  it('needs a title, days and end after start', () => {
    expect(validateFixedBlock({ ...classes, title: '  ' }).errors).toContain('Give it a title.')
    expect(validateFixedBlock({ ...classes, rule: { kind: 'weekly', weekdays: [] } }).errors).toContain('Pick at least one day.')
    expect(validateFixedBlock({ ...classes, end: '08:00' }).errors).toContain('End time must be after the start time.')
  })
  it('checks date ranges and one-off dates', () => {
    expect(
      validateFixedBlock({ ...classes, rule: { kind: 'weekly', weekdays: [1], from: '2026-12-01', until: '2026-11-01' } }).errors,
    ).toHaveLength(1)
    expect(validateFixedBlock({ ...classes, rule: { kind: 'once', date: '2026-12-03' } })).toEqual(ok)
    expect(validateFixedBlock({ ...classes, rule: { kind: 'once', date: '' } }).errors).toContain('Pick a date.')
  })
})

describe('validateMeal', () => {
  const dinner = { name: 'Dinner', windowStart: '19:00', windowEnd: '20:30', duration: 45 }
  it('accepts a meal that fits its window', () => expect(validateMeal(dinner)).toEqual(ok))
  it('rejects a meal longer than its window', () =>
    expect(validateMeal({ ...dinner, duration: 120 }).errors).toContain('The meal doesn’t fit inside its window.'))
  it('rejects zero duration and reversed windows', () => {
    expect(validateMeal({ ...dinner, duration: 0 }).errors).toHaveLength(1)
    expect(validateMeal({ ...dinner, windowEnd: '18:00' }).errors).toHaveLength(1)
  })
})

describe('availability', () => {
  const w = (id: string, weekday: AvailabilityWindow['weekday'], start: string, end: string): AvailabilityWindow => ({
    id,
    weekday,
    start,
    end,
    energy: 'normal',
  })

  it('validates single windows', () => {
    expect(validateWindow(w('a', 1, '16:00', '19:00'))).toEqual(ok)
    expect(validateWindow(w('a', 1, '19:00', '16:00')).errors).toHaveLength(1)
    expect(validateWindow(w('a', 1, '16:00', '16:10')).warnings).toHaveLength(1)
  })

  it('finds overlaps only on the same weekday, and touching is fine', () => {
    const windows = [
      w('a', 1, '16:00', '19:00'),
      w('b', 1, '19:00', '23:00'), // touches a: OK
      w('c', 1, '18:00', '20:00'), // overlaps a and b
      w('d', 2, '16:00', '19:00'), // other day
    ]
    expect(findOverlappingWindows(windows)).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ])
  })

  it('sums weekly minutes (acceptance scenario: 16–23 on weekdays = 35h)', () => {
    const weekdays = [1, 2, 3, 4, 5] as const
    const windows = weekdays.flatMap((d) => [w(`h${d}`, d, '16:00', '19:00'), w(`n${d}`, d, '19:00', '23:00')])
    expect(weeklyAvailableMinutes(windows)).toBe(35 * 60)
  })

  it('validates overrides', () => {
    expect(validateOverride({ date: '2026-12-05', kind: 'busy' })).toEqual(ok)
    expect(validateOverride({ date: '2026-12-05', kind: 'free', start: '13:00', end: '18:00' })).toEqual(ok)
    expect(validateOverride({ date: '2026-12-05', kind: 'free' }).errors).toHaveLength(1)
    expect(validateOverride({ date: '2026-12-05', kind: 'busy', start: '13:00' }).errors).toHaveLength(1)
    expect(validateOverride({ date: '', kind: 'busy' }).errors).toContain('Pick a date.')
  })
})

describe('rules & limits', () => {
  it('validates rules', () => {
    expect(validateRule({ kind: 'noGoalAfter', params: { time: '23:00', category: 'Study' } })).toEqual(ok)
    expect(validateRule({ kind: 'noGoalBefore', params: { time: 'x' } }).errors).toHaveLength(1)
    expect(validateRule({ kind: 'keepFree', params: { weekday: 0, start: '08:00', end: '12:00' } })).toEqual(ok)
    expect(validateRule({ kind: 'keepFree', params: { weekday: 0, start: '12:00', end: '08:00' } }).errors).toHaveLength(1)
  })

  it('validates limits', () => {
    expect(validateLimits(DEFAULT_SETTINGS)).toEqual(ok)
    expect(validateLimits({ ...DEFAULT_SETTINGS, dailyCapWeekday: 25 }).errors).toHaveLength(1)
    expect(validateLimits({ ...DEFAULT_SETTINGS, bufferMin: -1 }).errors).toHaveLength(1)
    expect(validateLimits({ ...DEFAULT_SETTINGS, demandingCap: 8 }).warnings).toHaveLength(1)
  })
})
