import { describe, expect, it } from 'vitest'
import { dayLoad, dayProgress, dayTimeline, deadlineMarkers, hourRange, monthGrid, nowAndNext, weekDates, type DayData } from './agenda'
import { plan } from './planner'
import { TODAY, midterm, reading, scenarioSetup, scenarioState, workout } from '../test/scenario'
import type { Session } from '../db/types'

const planned = plan(scenarioState(), TODAY).sessions
const data = (over: Partial<DayData> = {}): DayData => ({
  sessions: planned,
  fixedBlocks: scenarioSetup().fixedBlocks,
  goals: [midterm, workout, reading],
  locations: scenarioSetup().locations,
  ...over,
})
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

describe('dayTimeline', () => {
  it('merges the fixed program with the saved plan, in time order (acceptance Monday)', () => {
    const items = dayTimeline(TODAY, data())
    expect(items.map((i) => `${fmt(i.start)} ${i.kind} ${i.title} (${i.subtitle})`)).toEqual([
      '08:40 travel Home → Campus (20m)',
      '09:00 fixed Classes (6h · Campus)',
      '15:00 travel Campus → Home (20m)',
      '16:00 goal Algebra midterm (55m)',
      '19:00 meal Dinner (45m)',
      '19:55 travel Home → Gym (15m)',
      '20:10 goal Workout (45m · Gym)',
      '20:55 travel Gym → Home (15m)',
      '21:20 goal Reading (30m)',
    ])
    expect(items.find((i) => i.kind === 'fixed')!.locked).toBe(true)
    expect(items.find((i) => i.goalId === 'midterm')!.color).toBe(midterm.color)
  })

  it('labels reviews, and shows no fixed program on weekends', () => {
    expect(dayTimeline('2026-12-11', data()).some((i) => i.title === 'Review: Algebra midterm')).toBe(true)
    expect(dayTimeline('2026-11-28', data()).map((i) => i.kind)).toEqual(['meal'])
  })

  it('labels sessions with their topics (SPEC: “Algebra: Rings”)', () => {
    const topics = [
      { id: 'rings', goalId: 'midterm', name: 'Rings', order: 0, weight: 1, weak: false, done: false, reviewsDone: 0 },
      { id: 'groups', goalId: 'midterm', name: 'Groups', order: 1, weight: 1, weak: true, done: true, reviewsDone: 0 },
    ]
    const base = { kind: 'goal' as const, goalId: 'midterm', date: TODAY, status: 'planned' as const, frozen: false }
    const sessions: Session[] = [
      { ...base, id: 'a', start: '16:00', end: '17:00', topicIds: ['rings'] },
      { ...base, id: 'b', kind: 'review', start: '17:30', end: '17:50', topicIds: ['groups'], spacedReview: true },
      { ...base, id: 'c', kind: 'review', start: '18:00', end: '19:00', topicIds: ['groups', 'rings'] },
      { ...base, id: 'd', start: '20:00', end: '21:00', topicIds: ['gone'] },
    ]
    const items = dayTimeline(TODAY, data({ sessions, fixedBlocks: [], topics }))
    expect(items.map((i) => `${i.title} (${i.subtitle})`)).toEqual([
      'Algebra midterm: Rings (1h)',
      'Review: Algebra midterm — Groups (20m)',
      'Review: Algebra midterm (1h · Groups, Rings)',
      'Algebra midterm (1h)', // deleted topic: plain name
    ])
  })

  it('copes with sessions of a deleted goal', () => {
    const items = dayTimeline(TODAY, data({ goals: [] }))
    expect(items.some((i) => i.title === 'Deleted goal')).toBe(true)
  })
})

describe('nowAndNext', () => {
  const items = dayTimeline(TODAY, data())
  const title = (id?: string) => items.find((i) => i.id === id)?.title
  it('finds the current and next item', () => {
    const r = nowAndNext(items, 16 * 60 + 30)
    expect(title(r.current)).toBe('Algebra midterm')
    expect(title(r.next)).toBe('Dinner')
  })
  it('between items there is only a next one', () => {
    const r = nowAndNext(items, 17 * 60 + 30)
    expect(r.current).toBeUndefined()
    expect(title(r.next)).toBe('Dinner')
  })
  it('skips items already done', () => {
    const done = items.map((i) => (i.title === 'Algebra midterm' ? { ...i, status: 'done' as const } : i))
    expect(nowAndNext(done, 16 * 60 + 30).current).toBeUndefined()
  })
  it('nothing after the last item', () => {
    expect(nowAndNext(items, 23 * 60)).toEqual({ current: undefined, next: undefined })
  })
})

describe('dayProgress', () => {
  const s = (over: Partial<Session>): Session => ({ id: 'x', kind: 'goal', date: TODAY, start: '16:00', end: '17:00', status: 'planned', frozen: false, ...over })
  it('counts goal and review work only, by minutes', () => {
    const p = dayProgress([
      s({ status: 'done' }),
      s({ status: 'partial', actualMinutes: 15, start: '18:00', end: '18:30' }),
      s({ kind: 'review', start: '20:00', end: '21:00' }),
      s({ kind: 'meal', status: 'done' }),
    ])
    expect(p).toEqual({ total: 3, done: 1, plannedMinutes: 150, doneMinutes: 75, ratio: 0.5 })
  })
  it('an empty day is 0%', () => {
    expect(dayProgress([]).ratio).toBe(0)
  })
})

describe('week and month helpers', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekDates('2026-11-26')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(weekDates('2026-11-29')[0]).toBe('2026-11-23') // Sunday belongs to the week before
  })

  it('the hour range covers every item and at least 08–22', () => {
    expect(hourRange([])).toEqual({ from: 8, to: 22 })
    expect(hourRange([{ start: 6 * 60 + 30, end: 7 * 60 }, { start: 22 * 60, end: 23 * 60 + 10 }])).toEqual({ from: 6, to: 24 })
  })

  it('month grid: 6 Monday-first weeks', () => {
    const g = monthGrid('2026-12')
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual({ date: '2026-11-30', inMonth: false })
    expect(g[1]).toEqual({ date: '2026-12-01', inMonth: true })
    expect(g.filter((d) => d.inMonth)).toHaveLength(31)
  })

  it('day load is relative to the daily cap', () => {
    const tue = planned.filter((s) => s.date === '2026-11-24')
    const l = dayLoad(tue, 6)
    expect(l.minutes).toBe(50 + 30) // midterm + reading
    expect(l.ratio).toBeCloseTo(80 / 360)
  })

  it('deadline markers include review days and book targets, active goals only', () => {
    const m = deadlineMarkers([
      midterm,
      { ...reading, id: 'dune', type: 'book', name: 'Dune', deadline: '2027-01-10' },
      { ...midterm, id: 'paused', active: false, deadline: '2026-12-20' },
    ])
    expect(m.get('2026-12-12')).toEqual([{ goalId: 'midterm', name: 'Algebra midterm', color: midterm.color, kind: 'deadline' }])
    expect(m.get('2026-12-11')![0]!.kind).toBe('review')
    expect(m.get('2027-01-10')![0]!.kind).toBe('book')
    expect(m.has('2026-12-20')).toBe(false)
  })
})
