import { describe, expect, it } from 'vitest'
import { formatDuration, formatWeekdays, fromMinutes, isTime, spanMinutes, toMinutes } from './time'

describe('time helpers', () => {
  it('converts HH:mm <-> minutes', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('09:30')).toBe(570)
    expect(toMinutes('23:59')).toBe(1439)
    expect(fromMinutes(570)).toBe('09:30')
    expect(fromMinutes(1440)).toBe('00:00')
    expect(fromMinutes(-30)).toBe('23:30')
  })

  it('validates time strings', () => {
    expect(isTime('07:05')).toBe(true)
    expect(isTime('7:05')).toBe(false)
    expect(isTime('24:00')).toBe(false)
    expect(isTime('12:60')).toBe(false)
    expect(() => toMinutes('nope')).toThrow()
  })

  it('measures spans, wrapping past midnight', () => {
    expect(spanMinutes('16:00', '23:00')).toBe(420)
    expect(spanMinutes('00:00', '08:00')).toBe(480)
    expect(spanMinutes('23:30', '07:30')).toBe(480)
  })

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('formats weekday sets', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(formatWeekdays([6, 0])).toBe('Weekends')
    expect(formatWeekdays([5, 1, 3])).toBe('Mon, Wed, Fri')
    expect(formatWeekdays([5, 6, 0])).toBe('Fri–Sun')
    expect(formatWeekdays([1, 2])).toBe('Mon, Tue')
    expect(formatWeekdays([])).toBe('No days')
  })
})
