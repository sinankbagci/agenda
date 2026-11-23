import { describe, expect, it } from 'vitest'
import { applySessionLength, bucketBonus, completionByBucket, credit, energySuggestions, estimateHint, sessionLengthSuggestions, timeBucket } from './learning'
import { midterm, reading, workout } from '../test/scenario'
import type { AvailabilityWindow, Goal, Session } from '../db/types'

const TODAY = '2026-11-30' // Monday
let n = 0
const s = (goalId: string, date: string, start: string, end: string, status: Session['status'], over: Partial<Session> = {}): Session => ({
  id: `s${n++}`, kind: 'goal', goalId, date, start, end, status, frozen: false, ...over,
})
/** Weekdays of the last 4 weeks before TODAY. */
const lastWeekdays = (() => {
  const out: string[] = []
  for (let i = 28; i >= 1; i--) {
    const d = new Date(2026, 10, 30 - i)
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(`2026-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
})()

describe('completion rates', () => {
  it('credit: done 1, partial by minutes, skipped / missed 0', () => {
    expect(credit(s('g', TODAY, '16:00', '17:00', 'done'))).toBe(1)
    expect(credit(s('g', TODAY, '16:00', '17:00', 'partial', { actualMinutes: 15 }))).toBe(0.25)
    expect(credit(s('g', TODAY, '16:00', '17:00', 'skipped'))).toBe(0)
    expect(credit(s('g', TODAY, '16:00', '17:00', 'planned'))).toBe(0)
  })

  it('per goal per time bucket over the last 4 weeks; the bonus nudges toward what works', () => {
    expect(timeBucket(9 * 60)).toBe('morning')
    expect(timeBucket(16 * 60)).toBe('afternoon')
    expect(timeBucket(17 * 60)).toBe('evening')
    const ss = [
      ...['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'].map((d) => s('g', d, '16:00', '17:00', 'skipped')), // afternoons: 0/4
      ...['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'].map((d) => s('g', d, '20:00', '21:00', 'done')), // evenings: 4/4
      s('g', '2026-10-01', '20:00', '21:00', 'skipped'), // older than 4 weeks: ignored
      s('g', TODAY, '16:00', '17:00', 'planned'), // today isn't over
    ]
    const r = completionByBucket(ss, TODAY)
    expect(r.get('g')!.overall).toEqual({ attempts: 8, completions: 4, rate: 0.5 })
    expect(bucketBonus(r, 'g', 'afternoon')).toBe(-2)
    expect(bucketBonus(r, 'g', 'evening')).toBe(2)
    expect(bucketBonus(r, 'g', 'morning')).toBe(0) // no data
    expect(bucketBonus(r, 'other', 'evening')).toBe(0)
  })

  it('no bonus without enough attempts', () => {
    const r = completionByBucket([s('g', '2026-11-23', '16:00', '17:00', 'done'), s('g', '2026-11-24', '20:00', '21:00', 'skipped')], TODAY)
    expect(bucketBonus(r, 'g', 'afternoon')).toBe(0)
  })
})

describe('energy-tag suggestions (SPEC 4.1c)', () => {
  const win = (id: string, weekday: AvailabilityWindow['weekday'], start: string, end: string, energy: AvailabilityWindow['energy']): AvailabilityWindow => ({ id, weekday, start, end, energy })
  const weekends = [win('sat', 6, '10:00', '13:00', 'normal'), win('sun', 0, '10:00', '13:00', 'normal')]
  const weekendSessions = (status: Session['status']) =>
    ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22'].map((d) => s('midterm', d, '10:30', '11:30', status))

  it('“You focus best 10:00–13:00 on weekends — mark it high energy?”', () => {
    const sug = energySuggestions(weekends, [...weekendSessions('done')], [], TODAY)
    expect(sug).toHaveLength(1)
    expect(sug[0]).toMatchObject({ kind: 'energy', windowIds: ['sat', 'sun'], from: 'normal', to: 'high', message: 'You finish 6 of 6 sessions on weekends 10:00–13:00 — mark it high energy?' })
  })

  it('a high window where little gets done → normal; with low check-ins → low', () => {
    const high = [win('m', 1, '16:00', '19:00', 'high')]
    const ss = lastWeekdays.filter((d) => new Date(d).getUTCDay() === 1).map((d, i) => s('midterm', d, '16:00', '17:00', i === 0 ? 'done' : 'skipped'))
    expect(energySuggestions(high, ss, [], TODAY)[0]).toMatchObject({ to: 'normal', message: 'Only 1 of 4 sessions on Mon 16:00–19:00 get done — mark it normal energy instead of high?' })
    const tired = ss.map((x) => ({ date: x.date, energy: 1 as const, mood: 3 as const }))
    expect(energySuggestions(high, ss.map((x) => ({ ...x, status: 'skipped' as const })), tired, TODAY)[0]!.to).toBe('low')
  })

  it('nothing before ~2 weeks of history, with too few sessions, or when tags already fit', () => {
    expect(energySuggestions(weekends, weekendSessions('done').slice(-2), [], TODAY)).toEqual([]) // < 14 days, < 4 sessions
    expect(energySuggestions(weekends.map((w) => ({ ...w, energy: 'high' as const })), weekendSessions('done'), [], TODAY)).toEqual([])
    // check-ins say tired → don't push it to high even if things got done
    const tired = weekendSessions('done').map((x) => ({ date: x.date, energy: 2 as const, mood: 3 as const }))
    expect(energySuggestions(weekends, weekendSessions('done'), tired, TODAY)).toEqual([])
  })
})

describe('session length', () => {
  const g: Goal = { ...midterm, minSession: 45, maxSession: 90 }
  it('regularly stopping early → shorter sessions', () => {
    const ss = lastWeekdays.slice(-6).map((d) => s('midterm', d, '16:00', '16:55', 'partial', { actualMinutes: 35 }))
    const sug = sessionLengthSuggestions([g], ss, TODAY)
    expect(sug[0]).toMatchObject({ kind: 'sessionLength', goalId: 'midterm', from: 90, to: 35, message: 'You usually stop “Algebra midterm” after about 35m of 55m — plan sessions of up to 35m?' })
    expect(applySessionLength(g, 35)).toEqual({ maxSession: 35, minSession: 35 })
  })
  it('regularly going longer → longer sessions; recurring changes the session length', () => {
    const w: Goal = { ...workout }
    const ss = lastWeekdays.slice(-5).map((d) => s('workout', d, '20:10', '20:55', 'done', { actualMinutes: 65 }))
    expect(sessionLengthSuggestions([w], ss, TODAY)[0]).toMatchObject({ from: 45, to: 65 })
    expect(applySessionLength(w, 65)).toEqual({ sessionLength: 65, minSession: 65, maxSession: 65 })
  })
  it('needs 5 sessions and a clear pattern', () => {
    expect(sessionLengthSuggestions([g], lastWeekdays.slice(-4).map((d) => s('midterm', d, '16:00', '16:55', 'partial', { actualMinutes: 20 })), TODAY)).toEqual([])
    expect(sessionLengthSuggestions([g], lastWeekdays.slice(-6).map((d) => s('midterm', d, '16:00', '16:55', 'done', { actualMinutes: 55 })), TODAY)).toEqual([])
    expect(sessionLengthSuggestions([{ ...reading, active: false }], lastWeekdays.slice(-6).map((d) => s('reading', d, '21:00', '21:30', 'partial', { actualMinutes: 5 })), TODAY)).toEqual([])
  })
})

describe('estimate correction (SPEC 3.4)', () => {
  const past = (id: string, hours: number, category: Goal['category'] = 'Study'): Goal => ({ ...midterm, id, category, totalHours: hours, deadline: '2026-10-15' })
  const done = (goalId: string, minutes: number) => s(goalId, '2026-10-01', '10:00', '11:00', 'done', { actualMinutes: minutes })

  it('“Your past exams took ~1.3× your estimate — use 20h instead of 15h?”', () => {
    const goals = [past('a', 10), past('b', 20)]
    const sessions = [done('a', 780), done('b', 1560)] // 13h of 10, 26h of 20 → 1.3×
    expect(estimateHint('Study', 15, goals, sessions, [], '2026-11-30')).toEqual({
      ratio: 1.3, goals: 2, suggestedHours: 19.5, message: 'Your past exams and study goals took ~1.3× your estimate (2 goals) — use 19.5h instead of 15h?',
    })
  })
  it('logged time counts; other categories and unfinished goals don’t', () => {
    const goals = [past('a', 10), past('x', 10, 'Other'), { ...past('future', 10), deadline: '2027-01-01' }]
    const hint = estimateHint('Study', 10, goals, [done('a', 420), done('x', 900), done('future', 900)], [{ id: 'l', date: '2026-10-02', type: 'study', title: 'x', goalId: 'a', minutes: 60 }], '2026-11-30')
    expect(hint).toMatchObject({ ratio: 0.8, goals: 1, suggestedHours: 8 })
  })
  it('no hint when estimates were about right or there’s no history', () => {
    expect(estimateHint('Study', 15, [past('a', 10)], [done('a', 630)], [], '2026-11-30')).toBeUndefined() // 1.05×
    expect(estimateHint('Study', 15, [], [], [], '2026-11-30')).toBeUndefined()
  })
})
