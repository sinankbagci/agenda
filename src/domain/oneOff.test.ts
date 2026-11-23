import { describe, expect, it } from 'vitest'
import { eventToFixedBlock, extraTimeOverrides, overlapWarnings, pinnedSession, validateEvent, validateExtraTime, validateGoalSession } from './oneOff'
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
