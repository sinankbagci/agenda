/**
 * Focus Mode timer (SPEC 4.1b) as a pure state machine over timestamps.
 *
 * Nothing here counts ticks: every function takes `now` (epoch ms) and derives what has
 * happened from the stored timestamps, so a timer survives Safari suspending JS, the screen
 * locking, or the app being closed. Phases that ended while the app was away are "caught up"
 * by `advance`, which returns the finished intervals to store.
 *
 * Time accounting: work AND break minutes count toward the goal (a 50/10 cycle = 60 min).
 * Intervals keep the phase so a "work only" view is possible later.
 */
import type { ActiveTimer, FocusConfig, FocusInterval, FocusPhase, Goal, Session, Settings } from '../db/types'

const MIN = 60_000

export type IntervalDraft = Omit<FocusInterval, 'id'>

export function resolveConfig(goal: Pick<Goal, 'pomodoroWork' | 'pomodoroBreak' | 'pomodoroLongBreak' | 'cyclesBeforeLong'>, s: Pick<Settings, 'pomodoroWork' | 'pomodoroBreak' | 'pomodoroLongBreak' | 'cyclesBeforeLong'>): FocusConfig {
  return {
    work: goal.pomodoroWork ?? s.pomodoroWork,
    shortBreak: goal.pomodoroBreak ?? s.pomodoroBreak,
    longBreak: goal.pomodoroLongBreak ?? s.pomodoroLongBreak,
    cyclesBeforeLong: goal.cyclesBeforeLong ?? s.cyclesBeforeLong,
  }
}

export function startTimer(args: {
  goalId: string
  config: FocusConfig
  now: number
  sessionId?: string
  targets?: { id: string; prior: number }[]
}): ActiveTimer {
  const t: ActiveTimer = {
    id: 'active',
    goalId: args.goalId,
    phase: 'work',
    phaseStartedAt: args.now,
    phaseLength: args.config.work,
    cycle: 1,
    runStartedAt: args.now,
    config: args.config,
    targets: args.targets ?? [],
  }
  if (args.sessionId) t.sessionId = args.sessionId
  return t
}

const phaseEnd = (t: ActiveTimer) => t.phaseStartedAt + t.phaseLength * MIN
/** The clock that counts for this timer: frozen at `pausedAt` while paused. */
const clock = (t: ActiveTimer, now: number) => t.pausedAt ?? now

export function remainingMs(t: ActiveTimer, now: number): number {
  return Math.max(0, phaseEnd(t) - clock(t, now))
}

export function elapsedInPhaseMs(t: ActiveTimer, now: number): number {
  return Math.max(0, Math.min(clock(t, now), phaseEnd(t)) - t.phaseStartedAt)
}

export const isPaused = (t: ActiveTimer) => t.pausedAt !== undefined
export const isBreak = (t: ActiveTimer) => t.phase !== 'work'

/** What comes after the current phase. `undefined` = the run is over (after a long break). */
function nextPhase(t: ActiveTimer): { phase: FocusPhase; length: number; cycle: number } | undefined {
  const c = t.config
  if (t.phase === 'work') {
    const long = t.cycle % c.cyclesBeforeLong === 0
    return long ? { phase: 'longBreak', length: c.longBreak, cycle: t.cycle } : { phase: 'break', length: c.shortBreak, cycle: t.cycle }
  }
  if (t.phase === 'longBreak') return undefined
  return { phase: 'work', length: c.work, cycle: t.cycle + 1 }
}

const interval = (t: ActiveTimer, startedAt: number, endedAt: number): IntervalDraft => {
  const i: IntervalDraft = { goalId: t.goalId, phase: t.phase, startedAt, endedAt, minutes: Math.round((endedAt - startedAt) / MIN) }
  if (t.sessionId) i.sessionId = t.sessionId
  if (t.topicId) i.topicId = t.topicId
  return i
}

export interface AdvanceResult {
  timer: ActiveTimer
  /** Phases that finished, to store. */
  intervals: IntervalDraft[]
  /** How many phase changes happened (for the transition sound). */
  transitions: number
  /** The run ended by itself (a long break finished). */
  finished: boolean
}

/**
 * Bring the timer up to `now`: every phase whose end has passed is closed as an interval and
 * the next one starts exactly when it ended (not when the app noticed). Paused timers don't move.
 * A run ends by itself when a long break finishes, so a forgotten timer can't log hours.
 */
export function advance(t: ActiveTimer, now: number): AdvanceResult {
  let timer = t
  const intervals: IntervalDraft[] = []
  let transitions = 0
  if (isPaused(t)) return { timer, intervals, transitions, finished: false }
  let guard = 0
  while (phaseEnd(timer) <= now && guard++ < 1000) {
    const end = phaseEnd(timer)
    if (timer.phaseLength > 0) intervals.push(interval(timer, timer.phaseStartedAt, end))
    const next = nextPhase(timer)
    transitions++
    // Finished: park the timer as a zero-length phase at the end, so advancing it again is a no-op
    // (otherwise every later sync would log the last break again).
    if (!next) return { timer: { ...timer, phaseStartedAt: end, phaseLength: 0 }, intervals, transitions, finished: true }
    timer = { ...timer, phase: next.phase, phaseLength: next.length, cycle: next.cycle, phaseStartedAt: end }
  }
  return { timer, intervals, transitions, finished: false }
}

export function pause(t: ActiveTimer, now: number): ActiveTimer {
  return isPaused(t) ? t : { ...t, pausedAt: now }
}

/** Resume: the phase start moves forward by the paused time, so remaining time is unchanged. */
export function resume(t: ActiveTimer, now: number): ActiveTimer {
  if (!isPaused(t)) return t
  const { pausedAt, ...rest } = t
  return { ...rest, phaseStartedAt: t.phaseStartedAt + (now - pausedAt!) }
}

/** Skip the rest of a break: the break time so far still counts; the next work cycle starts now. */
export function skipBreak(t: ActiveTimer, now: number): { timer: ActiveTimer; intervals: IntervalDraft[] } {
  if (!isBreak(t)) return { timer: t, intervals: [] }
  const live = isPaused(t) ? resume(t, now) : t
  const intervals = now > live.phaseStartedAt ? [interval(live, live.phaseStartedAt, now)] : []
  return {
    timer: { ...live, phase: 'work', phaseLength: live.config.work, cycle: live.cycle + 1, phaseStartedAt: now },
    intervals,
  }
}

/** End the run now: the part of the current phase done so far is logged. */
export function endTimer(t: ActiveTimer, now: number): IntervalDraft[] {
  const stop = clock(t, now)
  return stop > t.phaseStartedAt ? [interval(t, t.phaseStartedAt, Math.min(stop, phaseEnd(t)))] : []
}

/** Minutes tracked in this run so far: stored intervals + the running part of the current phase. */
export function trackedMinutes(t: ActiveTimer, storedIntervals: readonly Pick<FocusInterval, 'startedAt' | 'endedAt' | 'goalId'>[], now: number): number {
  const stored = storedIntervals
    .filter((i) => i.goalId === t.goalId && i.startedAt >= t.runStartedAt)
    .reduce((ms, i) => ms + (i.endedAt - i.startedAt), 0)
  return (stored + elapsedInPhaseMs(t, now)) / MIN
}

/** Completed work cycles in the current set (for the ●●○○ counter). */
export function cycleDots(t: ActiveTimer): { done: number; total: number } {
  const total = t.config.cyclesBeforeLong
  const inSet = ((t.cycle - 1) % total) + 1
  const done = t.phase === 'work' ? inSet - 1 : inSet
  return { done, total }
}

export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ---------- Sessions ----------

const plannedMin = (s: Pick<Session, 'start' | 'end'>) => {
  const [sh, sm] = s.start.split(':').map(Number)
  const [eh, em] = s.end.split(':').map(Number)
  return eh! * 60 + em! - (sh! * 60 + sm!)
}

/**
 * Today's sessions a run fills: the one Focus was started from first, then the goal's other
 * open (planned / partial) work sessions of the day in time order. `prior` = minutes they had.
 */
export function pickTargets(goalId: string, todaysSessions: readonly Session[], fromSessionId?: string): { id: string; prior: number }[] {
  const open = todaysSessions
    .filter((s) => s.goalId === goalId && (s.kind === 'goal' || s.kind === 'review') && (s.status === 'planned' || s.status === 'partial'))
    .sort((a, b) => (a.id === fromSessionId ? -1 : b.id === fromSessionId ? 1 : a.start.localeCompare(b.start)))
  return open.map((s) => ({ id: s.id, prior: s.status === 'partial' ? s.actualMinutes ?? 0 : 0 }))
}

/** Minutes still planned for the targets — reaching it auto-completes them. */
export function plannedRemaining(targets: readonly { id: string; prior: number }[], sessions: readonly Session[]): number {
  let m = 0
  for (const t of targets) {
    const s = sessions.find((x) => x.id === t.id)
    if (s) m += Math.max(0, plannedMin(s) - t.prior)
  }
  return m
}

/**
 * Spread tracked minutes over the targets in order: fully covered → done, the next one →
 * partial with the real minutes, the rest untouched. Extra beyond the plan goes onto the last
 * target (it counts toward the goal's remaining hours). Idempotent: call it again with a new
 * total and it gives the new state.
 */
export function allocate(targets: readonly { id: string; prior: number }[], sessions: readonly Session[], tracked: number): Session[] {
  let left = Math.round(tracked)
  const out: Session[] = []
  const list = targets.map((t) => ({ t, s: sessions.find((x) => x.id === t.id) })).filter((x): x is { t: (typeof targets)[number]; s: Session } => !!x.s)
  list.forEach(({ t, s }, i) => {
    const need = Math.max(0, plannedMin(s) - t.prior)
    const last = i === list.length - 1
    const take = last ? left : Math.min(need, left)
    left -= take
    const actual = t.prior + take
    const { actualMinutes: _a, ...base } = s
    if (actual >= plannedMin(s)) out.push({ ...base, status: 'done', actualMinutes: actual })
    else if (actual > 0) out.push({ ...base, status: 'partial', actualMinutes: actual })
    else out.push({ ...base, status: 'planned' })
  })
  return out
}
