import { describe, expect, it } from 'vitest'
import {
  advance,
  allocate,
  cycleDots,
  endTimer,
  formatCountdown,
  pause,
  pickTargets,
  plannedRemaining,
  remainingMs,
  resolveConfig,
  resume,
  skipBreak,
  startTimer,
  trackedMinutes,
} from './focusTimer'
import { DEFAULT_SETTINGS } from '../db/defaults'
import type { Session } from '../db/types'

const MIN = 60_000
const T0 = Date.UTC(2026, 10, 23, 15, 0) // any fixed instant
const algebra = { work: 50, shortBreak: 10, longBreak: 20, cyclesBeforeLong: 2 }
const start = (config = algebra) => startTimer({ goalId: 'g', config, now: T0 })

describe('config', () => {
  it('uses the goal override, else the defaults', () => {
    expect(resolveConfig({}, DEFAULT_SETTINGS)).toEqual({ work: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLong: 4 })
    expect(resolveConfig({ pomodoroWork: 50, pomodoroBreak: 10, pomodoroLongBreak: 20, cyclesBeforeLong: 2 }, DEFAULT_SETTINGS)).toEqual(algebra)
  })
})

describe('countdown from timestamps', () => {
  it('remaining time is computed, not counted', () => {
    const t = start()
    expect(remainingMs(t, T0)).toBe(50 * MIN)
    expect(remainingMs(t, T0 + 20 * MIN + 30_000)).toBe(29 * MIN + 30_000)
    expect(formatCountdown(remainingMs(t, T0 + 20 * MIN + 30_000))).toBe('29:30')
    expect(remainingMs(t, T0 + 99 * MIN)).toBe(0)
  })

  it('pause freezes the clock; resume keeps the remaining time', () => {
    const p = pause(start(), T0 + 10 * MIN)
    expect(remainingMs(p, T0 + 60 * MIN)).toBe(40 * MIN) // an hour later, still 40 left
    expect(advance(p, T0 + 999 * MIN).intervals).toEqual([]) // paused timers don't move
    const r = resume(p, T0 + 60 * MIN)
    expect(r.pausedAt).toBeUndefined()
    expect(remainingMs(r, T0 + 60 * MIN)).toBe(40 * MIN)
    expect(remainingMs(r, T0 + 100 * MIN)).toBe(0)
  })
})

describe('advance (catching up after the app was away)', () => {
  it('work → short break → work, each starting exactly when the last ended', () => {
    const a = advance(start(), T0 + 52 * MIN)
    expect(a.transitions).toBe(1)
    expect(a.intervals).toEqual([{ goalId: 'g', phase: 'work', startedAt: T0, endedAt: T0 + 50 * MIN, minutes: 50 }])
    expect(a.timer).toMatchObject({ phase: 'break', phaseLength: 10, cycle: 1, phaseStartedAt: T0 + 50 * MIN })
    const b = advance(a.timer, T0 + 61 * MIN)
    expect(b.timer).toMatchObject({ phase: 'work', cycle: 2, phaseStartedAt: T0 + 60 * MIN })
  })

  it('a long break comes after N cycles, and the run ends when it finishes', () => {
    // locked for 3 hours: 50 work, 10 break, 50 work, 20 long break → done at 130 min
    const a = advance(start(), T0 + 180 * MIN)
    expect(a.intervals.map((i) => `${i.phase}:${i.minutes}`)).toEqual(['work:50', 'break:10', 'work:50', 'longBreak:20'])
    expect(a.finished).toBe(true)
    expect(a.intervals.reduce((m, i) => m + i.minutes, 0)).toBe(130) // breaks count too
    // advancing a finished timer again logs nothing more
    const again = advance(a.timer, T0 + 400 * MIN)
    expect(again.intervals).toEqual([])
    expect(again.finished).toBe(true)
    expect(remainingMs(a.timer, T0 + 400 * MIN)).toBe(0)
  })

  it('nothing happens before the phase ends', () => {
    expect(advance(start(), T0 + 49 * MIN)).toMatchObject({ transitions: 0, intervals: [], finished: false })
  })
})

describe('skip break and end', () => {
  it('skipping a break logs the break so far and starts the next work cycle now', () => {
    const inBreak = advance(start(), T0 + 53 * MIN).timer
    const s = skipBreak(inBreak, T0 + 53 * MIN)
    expect(s.intervals).toEqual([{ goalId: 'g', phase: 'break', startedAt: T0 + 50 * MIN, endedAt: T0 + 53 * MIN, minutes: 3 }])
    expect(s.timer).toMatchObject({ phase: 'work', cycle: 2, phaseStartedAt: T0 + 53 * MIN, phaseLength: 50 })
    expect(skipBreak(start(), T0).intervals).toEqual([]) // only during a break
  })

  it('ending logs the part of the current phase done so far (paused time excluded)', () => {
    expect(endTimer(start(), T0 + 20 * MIN)[0]).toMatchObject({ phase: 'work', minutes: 20 })
    const paused = pause(start(), T0 + 15 * MIN)
    expect(endTimer(paused, T0 + 90 * MIN)[0]).toMatchObject({ minutes: 15 })
    expect(endTimer(start(), T0)).toEqual([])
  })

  it('tracked minutes = stored intervals of this run + the running phase', () => {
    const a = advance(start(), T0 + 70 * MIN) // 50 work + 10 break stored, 10 into work 2
    const stored = [...a.intervals, { goalId: 'g', startedAt: T0 - 999 * MIN, endedAt: T0 - 900 * MIN }] // older run ignored
    expect(trackedMinutes(a.timer, stored, T0 + 70 * MIN)).toBe(70)
  })

  it('cycle dots', () => {
    const t = start({ ...algebra, cyclesBeforeLong: 4 })
    expect(cycleDots(t)).toEqual({ done: 0, total: 4 })
    expect(cycleDots(advance(t, T0 + 51 * MIN).timer)).toEqual({ done: 1, total: 4 }) // in the break after cycle 1
    expect(cycleDots(advance(t, T0 + 61 * MIN).timer)).toEqual({ done: 1, total: 4 }) // working on cycle 2
  })
})

describe('sessions: auto-complete and partial', () => {
  const s = (id: string, start: string, end: string, over: Partial<Session> = {}): Session => ({
    id, kind: 'goal', goalId: 'g', date: '2026-11-23', start, end, status: 'planned', frozen: false, ...over,
  })
  // SPEC example: 2 cycles of 50/10 = 120 min of Algebra planned today
  const today = [s('a', '16:00', '17:00'), s('b', '19:55', '20:55'), s('m', '19:00', '19:45', { kind: 'meal', goalId: undefined }), s('x', '21:00', '21:30', { goalId: 'other' })]

  it('targets: the session Focus started from first, then the goal’s other open sessions', () => {
    expect(pickTargets('g', today)).toEqual([{ id: 'a', prior: 0 }, { id: 'b', prior: 0 }])
    expect(pickTargets('g', today, 'b').map((t) => t.id)).toEqual(['b', 'a'])
    expect(pickTargets('g', [s('p', '10:00', '11:00', { status: 'partial', actualMinutes: 15 }), s('d', '12:00', '13:00', { status: 'done' })])).toEqual([{ id: 'p', prior: 15 }])
  })

  it('reaching the planned amount marks every session done (120 of 120)', () => {
    const targets = pickTargets('g', today)
    expect(plannedRemaining(targets, today)).toBe(120)
    expect(allocate(targets, today, 120).map((x) => `${x.id}:${x.status}:${x.actualMinutes}`)).toEqual(['a:done:60', 'b:done:60'])
  })

  it('ending early marks them partial with the real minutes', () => {
    expect(allocate(pickTargets('g', today), today, 75).map((x) => `${x.id}:${x.status}:${x.actualMinutes ?? '-'}`)).toEqual(['a:done:60', 'b:partial:15'])
    expect(allocate(pickTargets('g', today), today, 40).map((x) => `${x.id}:${x.status}:${x.actualMinutes ?? '-'}`)).toEqual(['a:partial:40', 'b:planned:-'])
  })

  it('extra time beyond the plan goes onto the last session (counts toward remaining hours)', () => {
    expect(allocate(pickTargets('g', today), today, 150).map((x) => `${x.id}:${x.status}:${x.actualMinutes}`)).toEqual(['a:done:60', 'b:done:90'])
  })

  it('earlier partial minutes are kept and added to', () => {
    const withPartial = [s('p', '10:00', '11:00', { status: 'partial', actualMinutes: 15 })]
    const targets = pickTargets('g', withPartial)
    expect(plannedRemaining(targets, withPartial)).toBe(45)
    expect(allocate(targets, withPartial, 45)[0]).toMatchObject({ status: 'done', actualMinutes: 60 })
    expect(allocate(targets, withPartial, 10)[0]).toMatchObject({ status: 'partial', actualMinutes: 25 })
  })

  it('is idempotent: allocating a new total gives the new state', () => {
    const targets = pickTargets('g', today)
    const once = allocate(targets, today, 120)
    expect(allocate(targets, once, 30).map((x) => x.status)).toEqual(['partial', 'planned'])
  })

})
