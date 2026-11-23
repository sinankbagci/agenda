import { describe, expect, it } from 'vitest'
import { lastWeekSummary, nextWeekPreview, reviewWeek, shouldShowReview } from './review'
import { midterm, reading, workout } from '../test/scenario'
import type { Goal, Session } from '../db/types'

let n = 0
const s = (goalId: string, date: string, status: Session['status'], over: Partial<Session> = {}): Session => ({
  id: `s${n++}`, kind: 'goal', goalId, date, start: '16:00', end: '17:00', status, frozen: false, ...over,
})
const created = (d: string) => new Date(`${d}T08:00`).getTime()

describe('which week', () => {
  it('on Sunday the coming week, otherwise the current one', () => {
    expect(reviewWeek('2026-11-29')).toBe('2026-11-30') // Sunday → next Monday
    expect(reviewWeek('2026-11-30')).toBe('2026-11-30') // Monday
    expect(reviewWeek('2026-12-03')).toBe('2026-11-30') // Thursday
  })
  it('banner until confirmed or dismissed', () => {
    expect(shouldShowReview('2026-11-29', [], [])).toBe(true)
    expect(shouldShowReview('2026-11-29', [{ weekStart: '2026-11-30', confirmedAt: 1, adjustments: [] }], [])).toBe(false)
    expect(shouldShowReview('2026-12-01', [], ['2026-11-30'])).toBe(false)
    expect(shouldShowReview('2026-12-01', [{ weekStart: '2026-11-23', confirmedAt: 1, adjustments: [] }], [])).toBe(true) // last week's doesn't count
  })
})

describe('last week', () => {
  const goals: Goal[] = [
    { ...midterm, createdAt: created('2026-11-01') },
    { ...workout, perWeek: 3, createdAt: created('2026-11-01') },
    { ...reading, createdAt: created('2026-11-01') },
  ]
  // the week before Mon 30 Nov: 23–29 Nov
  const sessions = [
    s('midterm', '2026-11-23', 'done'), s('midterm', '2026-11-24', 'partial', { actualMinutes: 30 }), s('midterm', '2026-11-25', 'skipped'), s('midterm', '2026-11-26', 'planned'),
    s('workout', '2026-11-16', 'done'), s('workout', '2026-11-18', 'done'), s('workout', '2026-11-20', 'done'), // week before: met
    s('workout', '2026-11-23', 'done'), s('workout', '2026-11-25', 'skipped'), s('workout', '2026-11-27', 'skipped'), // last week: missed → broken
    s('reading', '2026-11-23', 'done', { end: '16:30' }), s('reading', '2026-11-24', 'done', { end: '16:30' }),
    s('midterm', '2026-11-30', 'planned'), // next week — not in last week
  ]
  const r = lastWeekSummary({
    week: '2026-11-30', goals, sessions, today: '2026-11-30',
    logs: [{ id: 'l', date: '2026-11-28', type: 'study', title: 'extra', goalId: 'midterm', minutes: 45 }],
    checkIns: [{ date: '2026-11-23', energy: 4, mood: 3 }, { date: '2026-11-24', energy: 2, mood: 4 }, { date: '2026-11-10', energy: 1, mood: 1 }],
  })

  it('time per goal and category (sessions + linked log)', () => {
    expect(r.from).toBe('2026-11-23')
    expect(r.to).toBe('2026-11-29')
    expect(r.perGoal.map((g) => `${g.goalId}:${g.minutes}`)).toEqual(['midterm:135', 'reading:60', 'workout:60'])
    expect(r.perCategory).toEqual([{ category: 'Study', minutes: 135 }, { category: 'Fitness', minutes: 60 }, { category: 'Reading', minutes: 60 }])
    expect(r.totalMinutes).toBe(255)
  })
  it('sessions done vs planned', () => {
    expect(r.sessions).toEqual({ done: 4, partial: 1, skipped: 3, missed: 1, planned: 9 })
  })
  it('streaks kept / broken', () => {
    expect(r.streaks).toEqual([
      { goalId: 'workout', name: 'Workout', unit: 'week', before: 1, after: 0, status: 'broken' },
      { goalId: 'reading', name: 'Reading', unit: 'day', before: 0, after: 2, status: 'started' },
    ])
  })
  it('a weekly streak that broke the week before and was met last week is a new streak', () => {
    const w: Goal = { ...workout, perWeek: 2, createdAt: created('2026-11-02') }
    const ss = [
      s('workout', '2026-11-02', 'done'), s('workout', '2026-11-04', 'done'), // met
      s('workout', '2026-11-09', 'done'), s('workout', '2026-11-11', 'skipped'), // broken
      s('workout', '2026-11-16', 'done'), s('workout', '2026-11-18', 'done'), // last week: met
    ]
    const r = lastWeekSummary({ week: '2026-11-23', goals: [w], sessions: ss, logs: [], checkIns: [], today: '2026-11-23' })
    expect(r.streaks).toEqual([{ goalId: 'workout', name: 'Workout', unit: 'week', before: 0, after: 1, status: 'started' }])
  })

  it('average energy and mood of the week’s check-ins', () => {
    expect(r.checkIns).toEqual({ count: 2, energy: 3, mood: 3.5 })
  })
  it('goals that fell behind', () => {
    expect(r.behind.map((b) => `${b.goalId}:${b.progress.status}`)).toEqual(['midterm:behind'])
  })
})

describe('next week', () => {
  it('per-day planned time and upcoming deadlines (task shown on its “do it by” day)', () => {
    const goals: Goal[] = [midterm, { ...midterm, id: 'hw', name: 'Homework', oneOff: true, deadline: '2026-12-02' }, { ...midterm, id: 'far', deadline: '2027-01-30' }]
    const sessions = [s('midterm', '2026-11-30', 'planned'), s('midterm', '2026-11-30', 'planned', { start: '20:00', end: '20:30' }), s('hw', '2026-12-01', 'planned'), s('midterm', '2026-12-01', 'skipped')]
    const p = nextWeekPreview('2026-11-30', goals, sessions)
    expect(p.days.map((d) => d.minutes)).toEqual([90, 60, 0, 0, 0, 0, 0])
    expect(p.totalMinutes).toBe(150)
    expect(p.deadlines).toEqual([
      { goalId: 'hw', name: 'Homework', date: '2026-12-01', kind: 'task' },
      { goalId: 'midterm', name: 'Algebra midterm', date: '2026-12-12', kind: 'deadline' },
    ])
  })
})
