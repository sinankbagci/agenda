import { describe, expect, it } from 'vitest'
import { eventToFixedBlock, extraTimeOverrides, finishTask, goalToTask, groupOverrides, overlapWarnings, pinnedSession, taskDoBy, taskToGoal, validateEvent, validateExtraTime, validateGoalSession, validateTask } from './oneOff'
import { TODAY, midterm, scenarioSetup, workout } from '../test/scenario'
import type { Session } from '../db/types'

const FRI = '2026-11-27'
const ok = { errors: [], warnings: [] }

describe('event (tennis on Friday 13:00–15:00)', () => {
  const tennis = { title: 'Tennis', date: FRI, start: '13:00', end: '15:00' }
  it('validates', () => {
    expect(validateEvent(tennis, TODAY)).toEqual(ok)
    expect(validateEvent({ ...tennis, title: ' ' }, TODAY).errors).toContain('Give it a title.')
    expect(validateEvent({ ...tennis, end: '12:00' }, TODAY).errors).toContain('The end time must be after the start time.')
    expect(validateEvent({ ...tennis, date: '2026-11-20' }, TODAY).errors).toContain('The date is in the past.')
  })
  it('becomes a locked one-off fixed block', () => {
    expect(eventToFixedBlock({ ...tennis, title: ' Tennis ', locationId: 'club' })).toEqual({
      title: 'Tennis', rule: { kind: 'once', date: FRI }, start: '13:00', end: '15:00', locked: true, locationId: 'club',
    })
  })
  it('warns about what it overlaps: fixed program and sessions that stay put', () => {
    const done: Session = { id: 'd', kind: 'goal', goalId: 'midterm', date: FRI, start: '14:30', end: '15:30', status: 'done', frozen: false }
    const planned: Session = { ...done, id: 'p', status: 'planned' }
    expect(overlapWarnings(FRI, '13:00', '15:00', scenarioSetup().fixedBlocks, [done, planned], [midterm])).toEqual([
      'Overlaps “Classes” (09:00–15:00).',
      'Overlaps “Algebra midterm” (14:30–15:30), which stays where it is.',
    ])
    expect(overlapWarnings('2026-11-28', '13:00', '15:00', scenarioSetup().fixedBlocks, [], [])).toEqual([])
  })
})

describe('goal session at a chosen time', () => {
  const d = { goalId: 'midterm', date: '2026-11-28', start: '10:00', end: '12:00' }
  it('validates', () => {
    expect(validateGoalSession(d, [midterm], TODAY)).toEqual(ok)
    expect(validateGoalSession({ ...d, goalId: '' }, [midterm], TODAY).errors).toContain('Pick a goal.')
    expect(validateGoalSession({ ...d, date: '2026-12-12' }, [midterm], TODAY).warnings[0]).toMatch(/deadline/)
    expect(validateGoalSession(d, [{ ...midterm, active: false }], TODAY).warnings[0]).toMatch(/paused/)
  })
  it('is saved frozen and pinned, at the goal’s place', () => {
    expect(pinnedSession({ ...d, goalId: 'workout' }, workout, 'x')).toEqual({
      id: 'x', kind: 'goal', goalId: 'workout', date: '2026-11-28', start: '10:00', end: '12:00', status: 'planned', frozen: true, pinned: true, locationId: 'gym',
    })
  })
})

describe('extra free time (home all weekend)', () => {
  const weekend = { from: '2026-11-28', to: '2026-11-29', start: '10:00', end: '18:00', energy: 'high' as const, boostGoalIds: ['reading'] }
  it('validates the range', () => {
    expect(validateExtraTime(weekend, TODAY)).toEqual(ok)
    expect(validateExtraTime({ ...weekend, to: '2026-11-27' }, TODAY).errors).toContain('The last day must be on or after the first day.')
    expect(validateExtraTime({ ...weekend, to: '2027-01-30' }, TODAY).errors).toContain('At most 31 days at a time.')
    expect(validateExtraTime({ ...weekend, from: '2026-11-01' }, TODAY).errors).toContain('The first day is in the past.')
  })
  it('makes one free override per day, with energy and goals', () => {
    expect(extraTimeOverrides(weekend)).toEqual([
      { date: '2026-11-28', kind: 'free', start: '10:00', end: '18:00', energy: 'high', boostGoalIds: ['reading'] },
      { date: '2026-11-29', kind: 'free', start: '10:00', end: '18:00', energy: 'high', boostGoalIds: ['reading'] },
    ])
    expect(extraTimeOverrides({ ...weekend, boostGoalIds: [] })[0]).not.toHaveProperty('boostGoalIds')
  })
})

describe('one-off task (homework due tomorrow, 2 hours)', () => {
  const hw = { title: 'Analysis homework', minutes: 120, doBy: TODAY, category: 'Study' as const, focus: 'demanding' as const }
  it('validates', () => {
    expect(validateTask(hw, TODAY)).toEqual(ok)
    expect(validateTask({ ...hw, title: '' }, TODAY).errors).toContain('Say what the task is.')
    expect(validateTask({ ...hw, minutes: 5 }, TODAY).errors).toHaveLength(1)
    expect(validateTask({ ...hw, doBy: '2026-11-20' }, TODAY).errors).toContain('The “do it by” day is in the past.')
  })
  it('becomes a small deadline goal due the day after “do it by”, one 2 h session', () => {
    const g = taskToGoal(hw, '#3a6ea5', 1)
    expect(g).toMatchObject({ type: 'deadline', oneOff: true, name: 'Analysis homework', deadline: '2026-11-24', totalHours: 2, reviewDays: 0, minSession: 30, maxSession: 120, icon: '📋' })
    expect(taskToGoal({ ...hw, minutes: 20 }, '#000', 1)).toMatchObject({ minSession: 20, maxSession: 20 })
    expect(goalToTask({ ...g, id: 'x' })).toEqual(hw)
    expect(taskDoBy(g)).toBe('Mon 23 Nov')
  })
  it('finishing completes the task, marks this session done and drops the rest', () => {
    const task = { ...taskToGoal({ ...hw, minutes: 240 }, '#000', 1), id: 'hw' }
    const ss: Session[] = [
      { id: 'a', kind: 'goal', goalId: 'hw', date: TODAY, start: '16:00', end: '18:00', status: 'planned', frozen: false },
      { id: 'b', kind: 'goal', goalId: 'hw', date: TODAY, start: '19:55', end: '21:55', status: 'planned', frozen: false },
      { id: 'c', kind: 'goal', goalId: 'other', date: TODAY, start: '22:00', end: '22:30', status: 'planned', frozen: false },
    ]
    const r = finishTask(task, ss, 'a', 1000)
    expect(r.goal).toEqual({ completedAt: 1000 })
    expect(r.done.map((x) => `${x.id}:${x.status}:${x.actualMinutes}`)).toEqual(['a:done:120'])
    expect(r.removeIds).toEqual(['b'])
  })
})

describe('extra free time as one entry', () => {
  it('days saved together share a group and list as one', () => {
    const os = extraTimeOverrides({ from: '2026-11-28', to: '2026-11-29', start: '10:00', end: '18:00', energy: 'high', boostGoalIds: [] }, 'grp').map((o, i) => ({ ...o, id: `o${i}` }))
    expect(os.every((o) => o.groupId === 'grp')).toBe(true)
    const single = { id: 'busy', date: '2026-11-25', kind: 'busy' as const }
    expect(groupOverrides([...os, single]).map((g) => `${g.from}→${g.to}:${g.ids.length}`)).toEqual(['2026-11-25→2026-11-25:1', '2026-11-28→2026-11-29:2'])
  })
})
