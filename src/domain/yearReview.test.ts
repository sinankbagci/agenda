import { describe, expect, it } from 'vitest'
import { bestStreaks, deadlinesMet, heatmapWeeks, levelOf, minutesByDay, moodByMonth, watchedAndRead, yearTotals, yearsWithData } from './yearReview'
import { midterm, reading, workout } from '../test/scenario'
import type { BacklogItem, Goal, LogEntry, Session } from '../db/types'

let n = 0
const s = (goalId: string, date: string, status: Session['status'], over: Partial<Session> = {}): Session => ({
  id: `s${n++}`, kind: 'goal', goalId, date, start: '16:00', end: '17:00', status, frozen: false, ...over,
})
const at = (d: string) => new Date(`${d}T12:00`).getTime()

const sessions: Session[] = [
  s('midterm', '2026-03-02', 'done'),
  s('midterm', '2026-03-03', 'partial', { actualMinutes: 20 }),
  s('midterm', '2026-03-04', 'done', { actualMinutes: 150 }),
  s('midterm', '2026-03-06', 'skipped'),
  s('midterm', '2026-03-07', 'planned'), // missed → 0
  s('reading', '2026-03-04', 'done', { end: '16:30' }),
  s('midterm', '2025-12-31', 'done'), // other year
  { id: 'meal', kind: 'meal', date: '2026-03-02', start: '12:00', end: '13:00', status: 'done', frozen: false },
]
const logs: LogEntry[] = [
  { id: 'l1', date: '2026-03-05', type: 'study', title: 'library', goalId: 'midterm', minutes: 45 },
  { id: 'l2', date: '2026-03-05', type: 'walk', title: 'walk', minutes: 30 }, // not linked: heatmap yes, goals no
]

describe('heatmap', () => {
  it('levels by focused minutes', () => {
    expect([0, 1, 29, 30, 59, 60, 119, 120, 500].map(levelOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
  it('minutes per day: done/partial work + logs, nothing from meals, skipped or other years', () => {
    const m = minutesByDay(2026, sessions, logs)
    expect(Object.fromEntries(m)).toEqual({ '2026-03-02': 60, '2026-03-03': 20, '2026-03-04': 180, '2026-03-05': 75 })
  })
  it('Monday-first week columns covering the whole year, padded outside it', () => {
    const w = heatmapWeeks(2026, minutesByDay(2026, sessions, logs))
    // 1 Jan 2026 is a Thursday → first column Mon 29 Dec 2025 … ; 31 Dec 2026 is a Thursday
    expect(w.length).toBe(53)
    expect(w[0]!.slice(0, 3).every((c) => !c.date)).toBe(true)
    expect(w[0]![3]!.date).toBe('2026-01-01')
    expect(w.at(-1)![3]!.date).toBe('2026-12-31')
    expect(w.at(-1)![4]!.date).toBeUndefined()
    const cells = w.flat().filter((c) => c.date)
    expect(cells.length).toBe(365)
    expect(cells.find((c) => c.date === '2026-03-04')).toEqual({ date: '2026-03-04', minutes: 180, level: 4 })
  })
})

describe('totals', () => {
  const t = yearTotals(2026, [midterm, reading, workout], sessions, logs)
  it('hours per goal and category, sessions done, active days, longest run', () => {
    expect(t.minutes).toBe(335)
    expect(t.perGoal.map((g) => `${g.goalId}:${g.minutes}`)).toEqual(['midterm:275', 'reading:30'])
    expect(t.perCategory).toEqual([{ category: 'Study', minutes: 275 }, { category: 'Reading', minutes: 30 }])
    expect(t.sessionsDone).toBe(3)
    expect(t.activeDays).toBe(4)
    expect(t.longestRun).toBe(4) // 2–5 March
  })
  it('years with data, newest first', () => {
    expect(yearsWithData(sessions, logs, [{ date: '2024-05-01', energy: 3, mood: 3 }], 2026)).toEqual([2026, 2025, 2024])
  })
})

describe('best streaks', () => {
  it('per goal, best first; tasks left out', () => {
    const daily: Goal = { ...reading, createdAt: at('2026-03-01') }
    const ss = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05'].map((d) => s('reading', d, 'done', { end: '16:30' }))
    ss.push(s('reading', '2026-03-04', 'skipped', { end: '16:30' }))
    const r = bestStreaks(2026, [daily, { ...midterm, oneOff: true }], ss, [], '2026-03-06')
    expect(r).toEqual([{ goalId: 'reading', name: daily.name, unit: 'day', best: 3 }])
  })
})

describe('deadlines met', () => {
  const exam: Goal = { ...midterm, id: 'exam', deadline: '2026-03-10', totalHours: 4 }
  const late: Goal = { ...midterm, id: 'late', name: 'Late', deadline: '2026-04-01', totalHours: 10 }
  const future: Goal = { ...midterm, id: 'future', deadline: '2026-12-20' }
  const task: Goal = { ...midterm, id: 'hw', name: 'Homework', oneOff: true, deadline: '2026-03-03', totalHours: 2, completedAt: at('2026-03-02') }
  const lateTask: Goal = { ...task, id: 'hw2', deadline: '2026-03-03', completedAt: at('2026-03-04') }
  const ss = [s('exam', '2026-03-02', 'done', { actualMinutes: 200 }), s('exam', '2026-03-10', 'done'), s('late', '2026-03-02', 'done')]
  it('met when the hours were done before the deadline (tasks: finished in time)', () => {
    const r = deadlinesMet(2026, [exam, late, future, task, lateTask], ss, [{ id: 'x', date: '2026-03-05', type: 'study', title: 'x', goalId: 'exam', minutes: 40 }], '2026-11-23')
    expect(r.map((d) => `${d.goalId}:${d.deadline}:${d.met}`)).toEqual(['hw:2026-03-02:true', 'hw2:2026-03-02:false', 'exam:2026-03-10:true', 'late:2026-04-01:false'])
  })
})

describe('watched and read', () => {
  const item = (o: Partial<BacklogItem>): BacklogItem => ({ id: 'b', list: 'watch', title: 'Dune', type: 'movie', status: 'finished', addedAt: 0, ...o })
  it('finished items with ratings + logged ones, no duplicates, newest first', () => {
    const items = [
      item({ id: 'a', rating: 5, finishedAt: at('2026-02-01') }),
      item({ id: 'b', list: 'read', title: 'Old book', type: 'book', rating: 3, finishedAt: at('2025-06-01') }),
      item({ id: 'c', title: 'Unfinished', status: 'inProgress' }),
    ]
    const ls: LogEntry[] = [
      { id: '1', date: '2026-02-01', type: 'watched', title: 'Dune', note: '★★★★★' }, // came from finishing "Dune"
      { id: '2', date: '2026-04-01', type: 'read', title: 'An essay' },
      { id: '3', date: '2026-04-02', type: 'study', title: 'not media' },
    ]
    expect(watchedAndRead(2026, items, ls).map((c) => `${c.list}:${c.title}:${c.rating ?? '-'}`)).toEqual(['read:An essay:-', 'watch:Dune:5'])
  })
})

describe('energy and mood by month', () => {
  it('averages per month, empty months undefined', () => {
    const r = moodByMonth(2026, [
      { date: '2026-01-05', energy: 4, mood: 3 },
      { date: '2026-01-06', energy: 3, mood: 4 },
      { date: '2026-01-07', energy: 3, mood: 4 },
      { date: '2025-01-07', energy: 1, mood: 1 },
    ])
    expect(r[0]).toEqual({ month: 1, energy: 3.3, mood: 3.7, count: 3 })
    expect(r[1]).toEqual({ month: 2, energy: undefined, mood: undefined, count: 0 })
    expect(r.length).toBe(12)
  })
})
