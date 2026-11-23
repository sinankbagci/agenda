/**
 * Learning from the log (SPEC 3.4, 4.1c) — plain statistics and rules, no AI. PURE.
 *
 * Everything is derived from recent history every time (no stored Stats), so it can never go
 * stale: completion rate per goal per time bucket (feeds the planner's slot scoring), and three
 * kinds of suggestions the user confirms — energy-tag changes, session length, estimate
 * correction for new deadline goals.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { AvailabilityWindow, CheckIn, Energy, Goal, GoalCategory, ISODate, LogEntry, Session, TimeBucket, Weekday } from '../db/types'
import { formatDuration, formatWeekdays, toMinutes } from './time'

export const WINDOW_DAYS = 28 // "rolling last ~4 weeks"
export const MIN_BUCKET_ATTEMPTS = 3
export const MIN_GOAL_ATTEMPTS = 6
export const RATE_WEIGHT = 4 // score points per 1.0 of rate difference (clamped ±2)
export const MIN_HISTORY_DAYS = 14 // "after ~2–3 weeks"

export const timeBucket = (min: number): TimeBucket => (min < 12 * 60 ? 'morning' : min < 17 * 60 ? 'afternoon' : 'evening')

const add = (d: ISODate, n: number) => format(addDays(parseISO(d), n), 'yyyy-MM-dd')
const plannedMin = (s: Pick<Session, 'start' | 'end'>) => toMinutes(s.end) - toMinutes(s.start)
const isWork = (s: Session) => s.kind === 'goal' || s.kind === 'review'

/** How much of a session that is over got done: done 1, partial actual/planned, skipped / missed 0. */
export function credit(s: Session): number {
  if (s.status === 'done') return 1
  if (s.status === 'partial') return Math.min(1, (s.actualMinutes ?? 0) / Math.max(1, plannedMin(s)))
  return 0
}

/** Work sessions that are over, in the last `days` days before today. */
export function recentOver(sessions: readonly Session[], today: ISODate, days = WINDOW_DAYS): Session[] {
  const from = add(today, -days)
  return sessions.filter((s) => isWork(s) && s.date >= from && s.date < today)
}

export interface Rate {
  attempts: number
  completions: number
  rate: number
}

const rateOf = (ss: readonly Session[]): Rate => {
  const completions = ss.reduce((m, s) => m + credit(s), 0)
  return { attempts: ss.length, completions, rate: ss.length ? completions / ss.length : 0 }
}

/** Completion rate per goal, overall and per time bucket, over the last ~4 weeks. */
export function completionByBucket(sessions: readonly Session[], today: ISODate): Map<string, { overall: Rate; buckets: Partial<Record<TimeBucket, Rate>> }> {
  const out = new Map<string, { overall: Rate; buckets: Partial<Record<TimeBucket, Rate>> }>()
  const byGoal = new Map<string, Session[]>()
  for (const s of recentOver(sessions, today)) if (s.goalId) byGoal.set(s.goalId, [...(byGoal.get(s.goalId) ?? []), s])
  for (const [goalId, ss] of byGoal) {
    const buckets: Partial<Record<TimeBucket, Rate>> = {}
    for (const b of ['morning', 'afternoon', 'evening'] as TimeBucket[]) {
      const inB = ss.filter((s) => timeBucket(toMinutes(s.start)) === b)
      if (inB.length) buckets[b] = rateOf(inB)
    }
    out.set(goalId, { overall: rateOf(ss), buckets })
  }
  return out
}

/**
 * Slot-score bonus for placing `goalId` in `bucket` (SPEC 3.2: "+ historical completion rate of
 * that goal in that time-of-day bucket"): how much better / worse than the goal's own average,
 * only with enough attempts, clamped to ±2 so it nudges rather than overrides energy tags.
 */
export function bucketBonus(rates: ReturnType<typeof completionByBucket>, goalId: string, bucket: TimeBucket): number {
  const r = rates.get(goalId)
  const b = r?.buckets[bucket]
  if (!r || !b || r.overall.attempts < MIN_GOAL_ATTEMPTS || b.attempts < MIN_BUCKET_ATTEMPTS) return 0
  return Math.max(-2, Math.min(2, (b.rate - r.overall.rate) * RATE_WEIGHT))
}

// ---------- Suggestions ----------

export type Suggestion =
  | { kind: 'energy'; key: string; windowIds: string[]; weekdays: Weekday[]; start: string; end: string; from: Energy; to: Energy; message: string }
  | { kind: 'sessionLength'; key: string; goalId: string; from: number; to: number; message: string }

const daysPhrase = (wd: readonly Weekday[]) => {
  const label = formatWeekdays(wd)
  return label === 'Every day' ? 'every day' : label === 'Weekends' ? 'on weekends' : `on ${label}`
}

/**
 * Energy-tag suggestions (SPEC 4.1c). Windows with the same times and tag are grouped (Sat+Sun
 * 10–13 → "on weekends"). Needs ≥ 2 weeks of history and ≥ 4 sessions in the group.
 * - not high, ≥ 85% done (and check-ins not low) → mark it high
 * - high, ≤ 45% done → mark it normal; ≤ 30% done with check-in energy ≤ 2 → low
 */
export function energySuggestions(windows: readonly AvailabilityWindow[], sessions: readonly Session[], checkIns: readonly CheckIn[], today: ISODate): Suggestion[] {
  const work = sessions.filter(isWork)
  const firstDate = work.map((s) => s.date).sort()[0]
  if (!firstDate || differenceInCalendarDays(parseISO(today), parseISO(firstDate)) < MIN_HISTORY_DAYS) return []
  const recent = recentOver(sessions, today)
  const recentCheckIns = checkIns.filter((c) => c.date >= add(today, -WINDOW_DAYS) && c.date < today)

  const groups = new Map<string, AvailabilityWindow[]>()
  for (const w of windows) groups.set(`${w.start}-${w.end}-${w.energy}`, [...(groups.get(`${w.start}-${w.end}-${w.energy}`) ?? []), w])

  const out: Suggestion[] = []
  for (const [groupKey, ws] of groups) {
    const { start, end, energy } = ws[0]!
    const weekdays = [...new Set(ws.map((w) => w.weekday))].sort() as Weekday[]
    const inGroup = recent.filter((s) => {
      const wd = parseISO(s.date).getDay() as Weekday
      const m = toMinutes(s.start)
      return weekdays.includes(wd) && m >= toMinutes(start) && m < toMinutes(end)
    })
    if (inGroup.length < 4) continue
    const r = rateOf(inGroup)
    const ci = recentCheckIns.filter((c) => weekdays.includes(parseISO(c.date).getDay() as Weekday))
    const avgEnergy = ci.length ? ci.reduce((m, c) => m + c.energy, 0) / ci.length : undefined
    const done = Math.round(r.completions)
    const when = `${daysPhrase(weekdays)} ${start}–${end}`

    let to: Energy | undefined
    let message = ''
    if (energy !== 'high' && r.rate >= 0.85 && (avgEnergy === undefined || avgEnergy >= 3)) {
      to = 'high'
      message = `You finish ${done} of ${r.attempts} sessions ${when} — mark it high energy?`
    } else if (energy !== 'low' && r.rate <= 0.3 && avgEnergy !== undefined && avgEnergy <= 2) {
      to = 'low'
      message = `Only ${done} of ${r.attempts} sessions ${when} get done and your check-ins say low energy — mark it low energy?`
    } else if (energy === 'high' && r.rate <= 0.45) {
      to = 'normal'
      message = `Only ${done} of ${r.attempts} sessions ${when} get done — mark it normal energy instead of high?`
    }
    if (to) out.push({ kind: 'energy', key: `energy:${groupKey}:${to}`, windowIds: ws.map((w) => w.id), weekdays, start, end, from: energy, to, message })
  }
  return out
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round5 = (m: number) => Math.max(10, Math.round(m / 5) * 5)

/**
 * "If the user regularly stops early/late, suggest adjusting the session length" (SPEC 3.4).
 * ≥ 5 recent done/partial sessions with real minutes; median actual/planned ≤ 0.75 or ≥ 1.25.
 */
export function sessionLengthSuggestions(goals: readonly Goal[], sessions: readonly Session[], today: ISODate): Suggestion[] {
  const out: Suggestion[] = []
  for (const g of goals) {
    if (!g.active || g.oneOff) continue
    const ss = recentOver(sessions, today).filter((s) => s.goalId === g.id && s.kind === 'goal' && (s.status === 'done' || s.status === 'partial') && s.actualMinutes !== undefined)
    if (ss.length < 5) continue
    const ratio = median(ss.map((s) => s.actualMinutes! / Math.max(1, plannedMin(s))))
    const typicalPlanned = median(ss.map(plannedMin))
    const typicalActual = median(ss.map((s) => s.actualMinutes!))
    const current = g.type === 'recurring' ? g.sessionLength ?? g.maxSession : g.maxSession
    const to = Math.min(240, round5(typicalActual))
    if (to === current) continue
    if (ratio <= 0.75) {
      out.push({ kind: 'sessionLength', key: `len:${g.id}:${to}`, goalId: g.id, from: current, to, message: `You usually stop “${g.name}” after about ${formatDuration(Math.round(typicalActual))} of ${formatDuration(Math.round(typicalPlanned))} — plan sessions of up to ${formatDuration(to)}?` })
    } else if (ratio >= 1.25) {
      out.push({ kind: 'sessionLength', key: `len:${g.id}:${to}`, goalId: g.id, from: current, to, message: `You usually keep going on “${g.name}” (about ${formatDuration(Math.round(typicalActual))} instead of ${formatDuration(Math.round(typicalPlanned))}) — allow sessions of up to ${formatDuration(to)}?` })
    }
  }
  return out
}

/** The change a session-length suggestion makes to its goal. */
export function applySessionLength(goal: Goal, to: number): Partial<Goal> {
  if (goal.type === 'recurring') return { sessionLength: to, minSession: to, maxSession: to }
  return { maxSession: to, minSession: Math.min(goal.minSession, to) }
}

// ---------- Estimate correction ----------

export interface EstimateHint {
  ratio: number
  goals: number
  suggestedHours: number
  message: string
}

/**
 * For a new deadline goal (SPEC 3.4): finished deadline goals of the same category (deadline
 * passed, ≥ 2h planned) — actual study hours / planned hours, averaged. Suggest only when the
 * average is off by ≥ 15%. The user decides.
 */
export function estimateHint(category: GoalCategory, hours: number, goals: readonly Goal[], sessions: readonly Session[], logs: readonly LogEntry[], today: ISODate, excludeId?: string): EstimateHint | undefined {
  if (!(hours > 0)) return undefined
  const finished = goals.filter((g) => g.id !== excludeId && !g.oneOff && g.type === 'deadline' && g.category === category && g.deadline && g.deadline < today && (g.totalHours ?? 0) >= 2)
  const ratios = finished.map((g) => {
    const actual =
      sessions.filter((s) => s.goalId === g.id && s.kind === 'goal').reduce((m, s) => m + (s.status === 'done' ? s.actualMinutes ?? plannedMin(s) : s.status === 'partial' ? s.actualMinutes ?? 0 : 0), 0) +
      logs.filter((l) => l.goalId === g.id).reduce((m, l) => m + (l.minutes ?? 0), 0)
    return actual / ((g.totalHours ?? 1) * 60)
  }).filter((r) => r > 0)
  if (!ratios.length) return undefined
  const ratio = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 10) / 10
  if (Math.abs(ratio - 1) < 0.15) return undefined
  const suggestedHours = Math.max(0.5, Math.round(hours * ratio * 2) / 2)
  if (suggestedHours === hours) return undefined
  const what = category === 'Study' ? 'exams and study goals' : `${category.toLowerCase()} goals`
  return {
    ratio,
    goals: ratios.length,
    suggestedHours,
    message: `Your past ${what} took ~${ratio}× your estimate${ratios.length > 1 ? ` (${ratios.length} goals)` : ''} — use ${suggestedHours}h instead of ${hours}h?`,
  }
}
