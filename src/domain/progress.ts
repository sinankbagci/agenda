/**
 * Progress & streaks (SPEC 4.2). PURE: everything is derived from goals + stored sessions.
 * Progress is session-based (done / partial actual minutes; Focus Mode writes into sessions).
 */
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { Goal, ISODate, LogEntry, Session } from '../db/types'
import { loggedMinutes, loggedSessions } from './log'
import { countedMinutes } from './planner'
import { RAMP_END, RAMP_START } from './planner'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const add = (date: ISODate, n: number) => iso(addDays(parseISO(date), n))
const days = (a: ISODate, b: ISODate) => differenceInCalendarDays(parseISO(b), parseISO(a))
const weekOf = (date: ISODate) => iso(startOfWeek(parseISO(date), { weekStartsOn: 1 }))
const planned = (s: Pick<Session, 'start' | 'end'>) => {
  const [sh, sm] = s.start.split(':').map(Number)
  const [eh, em] = s.end.split(':').map(Number)
  return eh! * 60 + em! - (sh! * 60 + sm!)
}
const isWork = (s: Session) => s.kind === 'goal' || s.kind === 'review'
const ofGoal = (sessions: readonly Session[], goalId: string) => sessions.filter((s) => s.goalId === goalId && isWork(s))

/** All time spent on a goal (study + reviews), in minutes. */
export function totalInvested(goalId: string, sessions: readonly Session[], logs?: readonly LogEntry[]): number {
  return ofGoal(sessions, goalId).reduce((m, s) => m + countedMinutes(s), 0) + loggedMinutes(goalId, logs)
}

// ---------- Deadline goals ----------

export type DeadlineStatus = 'done' | 'ahead' | 'onTrack' | 'behind' | 'atRisk'

export interface DeadlineProgress {
  doneMinutes: number
  totalMinutes: number
  ratio: number
  daysLeft: number
  /** Where the planner's ramp says you'd be by now. */
  expectedMinutes: number
  status: DeadlineStatus
  /** behind: minutes behind the ramp; atRisk: minutes that don't fit before the review. */
  gapMinutes: number
}

/**
 * Hours done vs total, days left, and on track / behind (SPEC 4.2).
 * "Expected by now" follows the same 1.0 → 1.5 ramp the planner uses, from the goal's start
 * (created, or its first session if earlier) to the review day(s). Slack: 10% or 30 min.
 * `shortfallMinutes` comes from the last plan's warning — if the rest can't fit, it's at risk.
 */
export function deadlineProgress(goal: Goal, sessions: readonly Session[], today: ISODate, shortfallMinutes = 0, logs?: readonly LogEntry[]): DeadlineProgress {
  const totalMinutes = Math.round((goal.totalHours ?? 0) * 60)
  const doneMinutes =
    ofGoal(sessions, goal.id)
      .filter((s) => s.kind === 'goal')
      .reduce((m, s) => m + countedMinutes(s), 0) + loggedMinutes(goal.id, logs)
  const deadline = goal.deadline ?? today
  const daysLeft = Math.max(0, days(today, deadline))
  const first = ofGoal(sessions, goal.id).map((s) => s.date).sort()[0]
  const created = iso(new Date(goal.createdAt))
  const start = first && first < created ? first : created
  const studyEnd = add(deadline, -(goal.reviewDays ?? 0)) // exclusive
  const n = Math.max(1, days(start, studyEnd))
  const elapsed = Math.min(n, Math.max(0, days(start, today))) // full days before today
  const w = (i: number) => (n > 1 ? RAMP_START + ((RAMP_END - RAMP_START) * i) / (n - 1) : 1)
  let wAll = 0
  let wDone = 0
  for (let i = 0; i < n; i++) {
    wAll += w(i)
    if (i < elapsed) wDone += w(i)
  }
  const expectedMinutes = Math.round((totalMinutes * wDone) / wAll)
  const slack = Math.max(30, expectedMinutes * 0.1)

  let status: DeadlineStatus
  let gapMinutes = 0
  if (doneMinutes >= totalMinutes) status = 'done'
  else if (shortfallMinutes > 0) {
    status = 'atRisk'
    gapMinutes = shortfallMinutes
  } else if (doneMinutes + slack < expectedMinutes) {
    status = 'behind'
    gapMinutes = expectedMinutes - doneMinutes
  } else status = doneMinutes > expectedMinutes + 60 ? 'ahead' : 'onTrack'

  return { doneMinutes, totalMinutes, ratio: totalMinutes ? Math.min(1, doneMinutes / totalMinutes) : 0, daysLeft, expectedMinutes, status, gapMinutes }
}

// ---------- Streaks ----------

export interface Streak {
  unit: 'day' | 'week'
  current: number
  best: number
}

type Period = { key: string; met: boolean | null } // null = neutral (nothing planned, or still in progress)

function runs(periods: Period[]): { current: number; best: number } {
  let best = 0
  let run = 0
  for (const p of periods) {
    if (p.met === null) continue
    run = p.met ? run + 1 : 0
    best = Math.max(best, run)
  }
  return { current: run, best }
}

/**
 * Streaks for recurring, ongoing and book goals (SPEC 4.2).
 * - Weekly targets (recurring N×/week, ongoing min/week): a streak of weeks where the target was
 *   met, so rest days never break it.
 * - Daily targets (ongoing / book min/day): a streak of days.
 * A day or week with nothing planned for the goal (e.g. no free time) is neutral: it neither
 * counts nor breaks the streak. The current day/week is neutral until it's met.
 * The target is capped by what was actually planned that day/week (if only 3 of 4 workouts
 * fitted, doing those 3 keeps the streak).
 */
export function streak(goal: Goal, sessions: readonly Session[], today: ISODate, logs?: readonly LogEntry[]): Streak | undefined {
  const mine = ofGoal(sessions, goal.id)
  const created = iso(new Date(goal.createdAt))
  const firstSession = mine.map((s) => s.date).sort()[0]
  const start = firstSession && firstSession < created ? firstSession : created
  if (start > today) return undefined

  const weekly = goal.type === 'recurring' || (goal.type === 'ongoing' && !goal.minutesPerDay && !!goal.minutesPerWeek)
  const daily = (goal.type === 'ongoing' || goal.type === 'book') && !!goal.minutesPerDay
  if (!weekly && !daily) return undefined

  const periods: Period[] = []
  if (weekly) {
    for (let w = weekOf(start); w <= weekOf(today); w = add(w, 7)) {
      const inWeek = mine.filter((s) => s.date >= w && s.date <= add(w, 6))
      const current = w === weekOf(today)
      let met: boolean
      let neutral: boolean
      const inRange = (d: ISODate) => d >= w && d <= add(w, 6)
      const loggedCount = loggedSessions(goal.id, logs, inRange)
      if (goal.type === 'recurring') {
        const target = Math.min(goal.perWeek ?? 1, inWeek.length + loggedCount || (goal.perWeek ?? 1))
        const done = inWeek.filter((s) => s.status === 'done').length + loggedCount
        met = done >= target
        neutral = inWeek.length === 0 && loggedCount === 0
      } else {
        const plannedMin = inWeek.reduce((m, s) => m + planned(s), 0)
        const target = Math.min(goal.minutesPerWeek ?? 0, plannedMin || (goal.minutesPerWeek ?? 0))
        met = inWeek.reduce((m, s) => m + countedMinutes(s), 0) + loggedMinutes(goal.id, logs, inRange) >= target
        neutral = inWeek.length === 0 && loggedCount === 0
      }
      periods.push({ key: w, met: neutral || (current && !met) ? null : met })
    }
    return { unit: 'week', ...runs(periods) }
  }

  for (let d = start; d <= today; d = add(d, 1)) {
    const onDay = mine.filter((s) => s.date === d)
    const plannedMin = onDay.reduce((m, s) => m + planned(s), 0)
    const logged = loggedMinutes(goal.id, logs, (x) => x === d)
    const done = onDay.reduce((m, s) => m + countedMinutes(s), 0) + logged
    const target = Math.min(goal.minutesPerDay!, plannedMin || goal.minutesPerDay!)
    const met = done >= target
    const neutral = onDay.length === 0 && logged === 0
    periods.push({ key: d, met: neutral || (d === today && !met) ? null : met })
  }
  return { unit: 'day', ...runs(periods) }
}

// ---------- History & rates ----------

/** Minutes per Mon–Sun week for the last `weeks` weeks, oldest first (the detail chart). */
export function weeklyHistory(goalId: string, sessions: readonly Session[], today: ISODate, weeks = 12, logs?: readonly LogEntry[]): { weekStart: ISODate; minutes: number }[] {
  const mine = ofGoal(sessions, goalId)
  const last = weekOf(today)
  return Array.from({ length: weeks }, (_, i) => {
    const w = add(last, -7 * (weeks - 1 - i))
    const minutes =
      mine.filter((s) => s.date >= w && s.date <= add(w, 6)).reduce((m, s) => m + countedMinutes(s), 0) +
      loggedMinutes(goalId, logs, (d) => d >= w && d <= add(w, 6))
    return { weekStart: w, minutes: Math.round(minutes) }
  })
}

/** Sessions that are over (before today, or marked today): how many were done. */
export function completionRate(goalId: string, sessions: readonly Session[], today: ISODate): { done: number; partial: number; total: number; rate: number } {
  const over = ofGoal(sessions, goalId).filter((s) => s.date < today || (s.date === today && s.status !== 'planned'))
  const done = over.filter((s) => s.status === 'done').length
  const partial = over.filter((s) => s.status === 'partial').length
  return { done, partial, total: over.length, rate: over.length ? done / over.length : 0 }
}

/** What a weekly / daily target is, for the chart's reference line (minutes per week). */
export function weeklyTarget(goal: Goal): number | undefined {
  if (goal.type === 'recurring') return (goal.perWeek ?? 0) * (goal.sessionLength ?? 0) || undefined
  if (goal.minutesPerWeek) return goal.minutesPerWeek
  if (goal.minutesPerDay) return goal.minutesPerDay * 7
  return undefined
}

// ---------- Books ----------

export interface BookProgress {
  pagesDone: number
  totalPages: number
  ratio: number
  /** Pages per day at the current pace (last 14 days of page updates), if known. */
  pace?: number
  /** Estimated finish at that pace. */
  finishDate?: ISODate
  /** Compared with the target date, if there is one. */
  onTrack?: boolean
}

/** Record "I'm on page N" today (one entry per day, latest wins). */
export function logPages(goal: Pick<Goal, 'pageLog' | 'totalPages'>, pages: number, today: ISODate): Pick<Goal, 'pagesDone' | 'pageLog'> {
  const p = Math.max(0, Math.min(Math.round(pages), goal.totalPages ?? Infinity))
  const log = (goal.pageLog ?? []).filter((e) => e.date !== today)
  log.push({ date: today, pages: p })
  log.sort((a, b) => a.date.localeCompare(b.date))
  return { pagesDone: p, pageLog: log }
}

export function validatePages(pages: number, totalPages: number | undefined): string | undefined {
  if (!Number.isFinite(pages) || pages < 0 || !Number.isInteger(pages)) return 'Enter a page number.'
  if (totalPages && pages > totalPages) return `The book has ${totalPages} pages.`
  return undefined
}

export function bookProgress(goal: Goal, today: ISODate): BookProgress {
  const totalPages = goal.totalPages ?? 0
  const pagesDone = goal.pagesDone ?? 0
  const out: BookProgress = { pagesDone, totalPages, ratio: totalPages ? Math.min(1, pagesDone / totalPages) : 0 }
  const log = [...(goal.pageLog ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  if (log.length >= 2) {
    const latest = log[log.length - 1]!
    const windowStart = add(today, -14)
    const ref = log.find((e) => e.date >= windowStart && e.date < latest.date) ?? log[log.length - 2]!
    const span = Math.max(1, days(ref.date, today))
    const pace = (latest.pages - ref.pages) / span
    if (pace > 0) {
      out.pace = Math.round(pace * 10) / 10
      if (pagesDone < totalPages) out.finishDate = add(today, Math.ceil((totalPages - pagesDone) / pace))
      else out.finishDate = latest.date
      if (goal.deadline) out.onTrack = out.finishDate <= goal.deadline
    }
  }
  return out
}
