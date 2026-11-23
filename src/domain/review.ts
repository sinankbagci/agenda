/**
 * Weekly review (SPEC 4.4). PURE: which week to review, and the numbers for
 * "last week" and "next week". Weeks run Monday–Sunday.
 */
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import type { CheckIn, Goal, GoalCategory, ISODate, LogEntry, Session, WeeklyReview } from '../db/types'
import { countedMinutes } from './planner'
import { deadlineProgress, streak, type DeadlineProgress } from './progress'
import { toMinutes } from './time'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const add = (d: ISODate, n: number) => iso(addDays(parseISO(d), n))
const monday = (d: ISODate) => iso(startOfWeek(parseISO(d), { weekStartsOn: 1 }))
const isWork = (s: Session) => s.kind === 'goal' || s.kind === 'review'

/**
 * The week being planned: on Sunday it's the coming week; any other day it's the current one
 * ("shown on Sunday, or on first open of a new week").
 */
export function reviewWeek(today: ISODate): ISODate {
  return parseISO(today).getDay() === 0 ? add(today, 1) : monday(today)
}

/** Show the "Plan your week" banner: Sunday, or a new week not yet confirmed — unless dismissed. */
export function shouldShowReview(today: ISODate, reviews: readonly WeeklyReview[], dismissedWeeks: readonly ISODate[]): boolean {
  const week = reviewWeek(today)
  return !reviews.some((r) => r.weekStart === week) && !dismissedWeeks.includes(week)
}

export interface GoalWeek {
  goalId: string
  name: string
  color: string
  category: GoalCategory
  minutes: number
}

export type StreakChange = { goalId: string; name: string; unit: 'day' | 'week'; before: number; after: number; status: 'kept' | 'broken' | 'started' }

export interface LastWeek {
  from: ISODate
  to: ISODate
  totalMinutes: number
  perGoal: GoalWeek[]
  perCategory: { category: GoalCategory; minutes: number }[]
  sessions: { done: number; partial: number; skipped: number; missed: number; planned: number }
  streaks: StreakChange[]
  behind: { goalId: string; name: string; progress: DeadlineProgress }[]
  checkIns: { count: number; energy?: number; mood?: number }
}

/** The week before `week` (SPEC 4.4 "Last week"). */
export function lastWeekSummary(args: {
  week: ISODate
  goals: readonly Goal[]
  sessions: readonly Session[]
  logs: readonly LogEntry[]
  checkIns: readonly CheckIn[]
  /** goalId → shortfall minutes from the last plan. */
  shortfalls?: ReadonlyMap<string, number>
  today: ISODate
}): LastWeek {
  const { week, goals, sessions, logs, checkIns, today } = args
  const from = add(week, -7)
  const to = add(week, -1)
  const inWeek = (d: ISODate) => d >= from && d <= to
  const work = sessions.filter((s) => isWork(s) && inWeek(s.date))
  const byGoal = new Map<string, number>()
  for (const s of work) if (s.goalId) byGoal.set(s.goalId, (byGoal.get(s.goalId) ?? 0) + countedMinutes(s))
  for (const l of logs) if (l.goalId && inWeek(l.date) && l.minutes) byGoal.set(l.goalId, (byGoal.get(l.goalId) ?? 0) + l.minutes)

  const perGoal: GoalWeek[] = [...byGoal]
    .map(([goalId, minutes]) => {
      const g = goals.find((x) => x.id === goalId)
      return { goalId, name: g?.name ?? 'Deleted goal', color: g?.color ?? '#888', category: g?.category ?? ('Other' as GoalCategory), minutes: Math.round(minutes) }
    })
    .filter((g) => g.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
  const cats = new Map<GoalCategory, number>()
  for (const g of perGoal) cats.set(g.category, (cats.get(g.category) ?? 0) + g.minutes)

  const count = (pred: (s: Session) => boolean) => work.filter(pred).length
  const streaks: StreakChange[] = []
  for (const g of goals) {
    if (!g.active || g.oneOff) continue
    const after = streak(g, sessions, week, logs) // as of Monday: last week is complete
    if (!after) continue
    // "before last week": for weekly streaks as of last week's Monday (that week still in progress,
    // so it neither counts nor breaks); for daily ones as of the Sunday before
    const before = streak(g, sessions, after.unit === 'week' ? from : add(from, -1), logs)
    if (!before) continue
    if (after.current > before.current) streaks.push({ goalId: g.id, name: g.name, unit: after.unit, before: before.current, after: after.current, status: before.current ? 'kept' : 'started' })
    else if (before.current > 0 && after.current < before.current) streaks.push({ goalId: g.id, name: g.name, unit: after.unit, before: before.current, after: after.current, status: 'broken' })
  }

  const behind = goals
    .filter((g) => g.active && g.type === 'deadline' && !g.completedAt && g.deadline && g.deadline > today)
    .map((g) => ({ goalId: g.id, name: g.name, progress: deadlineProgress(g, sessions, today, args.shortfalls?.get(g.id) ?? 0, logs) }))
    .filter((x) => x.progress.status === 'behind' || x.progress.status === 'atRisk')

  const ci = checkIns.filter((c) => inWeek(c.date))
  const avg = (k: 'energy' | 'mood') => (ci.length ? Math.round((ci.reduce((m, c) => m + c[k], 0) / ci.length) * 10) / 10 : undefined)

  return {
    from,
    to,
    totalMinutes: perGoal.reduce((m, g) => m + g.minutes, 0),
    perGoal,
    perCategory: [...cats].map(([category, minutes]) => ({ category, minutes })).sort((a, b) => b.minutes - a.minutes || a.category.localeCompare(b.category)),
    sessions: {
      done: count((s) => s.status === 'done'),
      partial: count((s) => s.status === 'partial'),
      skipped: count((s) => s.status === 'skipped'),
      missed: count((s) => s.status === 'planned' && s.date < today),
      planned: work.length,
    },
    streaks,
    behind,
    checkIns: { count: ci.length, energy: avg('energy'), mood: avg('mood') },
  }
}

export interface NextWeek {
  days: { date: ISODate; minutes: number; goals: { goalId: string; minutes: number }[] }[]
  totalMinutes: number
  deadlines: { goalId: string; name: string; date: ISODate; kind: 'deadline' | 'task' | 'book' }[]
}

/** Preview of the planned week + deadlines in it and the week after (SPEC 4.4 "Next week"). */
export function nextWeekPreview(week: ISODate, goals: readonly Goal[], sessions: readonly Session[]): NextWeek {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = add(week, i)
    const mine = sessions.filter((s) => s.date === date && isWork(s) && s.status !== 'skipped')
    const per = new Map<string, number>()
    for (const s of mine) if (s.goalId) per.set(s.goalId, (per.get(s.goalId) ?? 0) + toMinutes(s.end) - toMinutes(s.start))
    return { date, minutes: [...per.values()].reduce((a, b) => a + b, 0), goals: [...per].map(([goalId, minutes]) => ({ goalId, minutes })) }
  })
  const until = add(week, 13)
  const deadlines = goals
    .filter((g) => g.active && !g.completedAt && g.deadline && (g.type === 'deadline' || g.type === 'book'))
    .map((g) => {
      // a task's deadline is the day after "do it by"
      const date = g.oneOff ? add(g.deadline!, -1) : g.deadline!
      return { goalId: g.id, name: g.name, date, kind: (g.oneOff ? 'task' : g.type === 'book' ? 'book' : 'deadline') as NextWeek['deadlines'][number]['kind'] }
    })
    .filter((d) => d.date >= week && d.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date))
  return { days, totalMinutes: days.reduce((m, d) => m + d.minutes, 0), deadlines }
}
