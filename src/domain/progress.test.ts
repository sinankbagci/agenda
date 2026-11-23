import { describe, expect, it } from 'vitest'
import { bookProgress, completionRate, deadlineProgress, logPages, streak, totalInvested, validatePages, weeklyHistory, weeklyTarget } from './progress'
import { midterm, reading, workout } from '../test/scenario'
import type { Goal, Session } from '../db/types'

const created = (date: string) => new Date(`${date}T08:00`).getTime()
let n = 0
const s = (goalId: string, date: string, status: Session['status'], over: Partial<Session> = {}): Session => ({
  id: `s${n++}`, kind: 'goal', goalId, date, start: '16:00', end: '17:00', status, frozen: false, ...over,
})

describe('deadline progress (15h midterm, created Mon 23 Nov, deadline Sat 12 Dec, 1 review day)', () => {
  const g: Goal = { ...midterm, createdAt: created('2026-11-23') }
  // study window: 23 Nov … 10 Dec = 18 days, ramp 1.0 → 1.5

  it('on day one nothing is expected yet', () => {
    expect(deadlineProgress(g, [], '2026-11-23')).toMatchObject({ doneMinutes: 0, totalMinutes: 900, daysLeft: 19, expectedMinutes: 0, status: 'onTrack' })
  })

  it('on track when done keeps up with the ramp (with a little slack)', () => {
    const done = ['23', '24', '25', '26', '27'].map((d) => s('midterm', `2026-11-${d}`, 'done')) // 5 × 60 = 300
    const p = deadlineProgress(g, done, '2026-11-30') // 7 days elapsed → ramp expects ≈ 316
    expect(p.expectedMinutes).toBeGreaterThan(290)
    expect(p.expectedMinutes).toBeLessThan(330)
    expect(p.status).toBe('onTrack')
    expect(p.ratio).toBeCloseTo(300 / 900)
  })

  it('behind (with by how much) when well short; ahead when well over', () => {
    const little = [s('midterm', '2026-11-23', 'done'), s('midterm', '2026-11-24', 'partial', { actualMinutes: 20 })]
    const p = deadlineProgress(g, little, '2026-11-30')
    expect(p.status).toBe('behind')
    expect(p.gapMinutes).toBe(p.expectedMinutes - 80)
    const lots = Array.from({ length: 8 }, (_, i) => s('midterm', '2026-11-24', 'done', { start: `${10 + i}:00`, end: `${11 + i}:00` }))
    expect(deadlineProgress(g, lots, '2026-11-30').status).toBe('ahead')
  })

  it('won’t fit (at risk) when the plan reported a shortfall; done when the hours are in', () => {
    expect(deadlineProgress(g, [], '2026-11-30', 180)).toMatchObject({ status: 'atRisk', gapMinutes: 180 })
    const all = Array.from({ length: 15 }, (_, i) => s('midterm', `2026-11-${String(23 + (i % 7)).padStart(2, '0')}`, 'done', { start: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, end: `${String(9 + Math.floor(i / 7)).padStart(2, '0')}:00` }))
    expect(deadlineProgress(g, all, '2026-12-01').status).toBe('done')
  })

  it('reviews are extra: they count as time invested, not toward the 15h', () => {
    const ss = [s('midterm', '2026-11-23', 'done'), s('midterm', '2026-11-24', 'done', { kind: 'review', end: '16:20' })]
    expect(deadlineProgress(g, ss, '2026-11-25').doneMinutes).toBe(60)
    expect(totalInvested('midterm', ss)).toBe(80)
  })
})

describe('streaks', () => {
  it('weekly goals count weeks where the target was met — rest days never break it', () => {
    const g: Goal = { ...workout, perWeek: 3, createdAt: created('2026-11-02') }
    const week = (mon: string, done: number, of = 3) =>
      Array.from({ length: of }, (_, i) => s('workout', mon.replace(/\d\d$/, (d) => String(+d + i * 2).padStart(2, '0')), i < done ? 'done' : 'skipped'))
    const ss = [...week('2026-11-02', 3), ...week('2026-11-09', 2), ...week('2026-11-16', 3), ...week('2026-11-23', 3)]
    expect(streak(g, ss, '2026-11-29')).toEqual({ unit: 'week', current: 2, best: 2 })
    // the current week still in progress doesn't break it
    expect(streak(g, [...ss, ...week('2026-11-30', 1)], '2026-12-02')).toEqual({ unit: 'week', current: 2, best: 2 })
  })

  it('if only 3 of 4 workouts fitted in a week, doing those 3 keeps the streak', () => {
    const g: Goal = { ...workout, perWeek: 4, createdAt: created('2026-11-16') }
    const ss = ['16', '18', '20', '23', '25', '27'].map((d) => s('workout', `2026-11-${d}`, 'done'))
    expect(streak(g, ss, '2026-11-30')).toEqual({ unit: 'week', current: 2, best: 2 })
  })

  it('daily goals: days without anything planned (weekends) are neutral; a missed day breaks it', () => {
    const g: Goal = { ...reading, createdAt: created('2026-11-16') }
    const weekdays = ['16', '17', '18', '19', '20', '23', '24'].map((d) => s('reading', `2026-11-${d}`, 'done', { end: '16:30' }))
    expect(streak(g, weekdays, '2026-11-24')).toEqual({ unit: 'day', current: 7, best: 7 })
    const broken = weekdays.map((x) => (x.date === '2026-11-19' ? { ...x, status: 'planned' as const } : x)) // missed Thursday
    expect(streak(g, broken, '2026-11-24')).toEqual({ unit: 'day', current: 3, best: 3 })
    // today not done yet: neutral
    expect(streak(g, [...weekdays, s('reading', '2026-11-25', 'planned', { end: '16:30' })], '2026-11-25')!.current).toBe(7)
    // partly done on a day counts only if it reached what was planned
    expect(streak(g, [s('reading', '2026-11-16', 'partial', { actualMinutes: 15, end: '16:30' })], '2026-11-17')!.current).toBe(0)
  })

  it('weekly minutes (ongoing per week) and no streak for deadline goals', () => {
    const lang: Goal = { ...reading, id: 'lang', minutesPerDay: undefined, minutesPerWeek: 90, createdAt: created('2026-11-16') }
    const ss = [s('lang', '2026-11-16', 'done'), s('lang', '2026-11-18', 'partial', { actualMinutes: 30 }), s('lang', '2026-11-23', 'done', { end: '17:30' })]
    expect(streak(lang, ss, '2026-11-30')).toEqual({ unit: 'week', current: 2, best: 2 })
    expect(streak(midterm, [], '2026-11-30')).toBeUndefined()
  })
})

describe('history, rate, targets', () => {
  it('minutes per week, oldest first, current week last', () => {
    const ss = [s('reading', '2026-11-16', 'done'), s('reading', '2026-11-24', 'partial', { actualMinutes: 25 }), s('reading', '2026-11-25', 'planned')]
    const h = weeklyHistory('reading', ss, '2026-11-25', 3)
    expect(h).toEqual([
      { weekStart: '2026-11-09', minutes: 0 },
      { weekStart: '2026-11-16', minutes: 60 },
      { weekStart: '2026-11-23', minutes: 25 },
    ])
  })

  it('completion rate counts sessions that are over', () => {
    const ss = [s('g', '2026-11-20', 'done'), s('g', '2026-11-21', 'skipped'), s('g', '2026-11-22', 'planned'), s('g', '2026-11-23', 'partial'), s('g', '2026-11-23', 'planned'), s('g', '2026-11-24', 'done')]
    expect(completionRate('g', ss, '2026-11-23')).toEqual({ done: 1, partial: 1, total: 4, rate: 0.25 })
  })

  it('weekly target line', () => {
    expect(weeklyTarget(workout)).toBe(4 * 45)
    expect(weeklyTarget(reading)).toBe(210)
    expect(weeklyTarget(midterm)).toBeUndefined()
  })
})

describe('books', () => {
  const book: Goal = { ...reading, id: 'dune', type: 'book', name: 'Dune', totalPages: 412, pagesDone: 0, deadline: '2026-12-31', createdAt: created('2026-11-01') }

  it('logging pages keeps one entry per day and clamps to the book', () => {
    let g = { ...book, ...logPages(book, 40, '2026-11-20') }
    g = { ...g, ...logPages(g, 55, '2026-11-20') }
    g = { ...g, ...logPages(g, 999, '2026-11-21') }
    expect(g.pageLog).toEqual([{ date: '2026-11-20', pages: 55 }, { date: '2026-11-21', pages: 412 }])
    expect(g.pagesDone).toBe(412)
    expect(validatePages(500, 412)).toBe('The book has 412 pages.')
    expect(validatePages(12.5, 412)).toBe('Enter a page number.')
  })

  it('pace from the last two weeks and an estimated finish date', () => {
    const g = { ...book, pagesDone: 160, pageLog: [{ date: '2026-11-01', pages: 0 }, { date: '2026-11-11', pages: 60 }, { date: '2026-11-21', pages: 160 }] }
    const p = bookProgress(g, '2026-11-21') // since 11 Nov: 100 pages / 10 days
    expect(p).toMatchObject({ pagesDone: 160, totalPages: 412, pace: 10, finishDate: '2026-12-17', onTrack: true })
    expect(p.ratio).toBeCloseTo(160 / 412)
    expect(bookProgress({ ...g, deadline: '2026-12-10' }, '2026-11-21').onTrack).toBe(false)
    expect(bookProgress(book, '2026-11-21').pace).toBeUndefined() // not enough page updates yet
  })
})
