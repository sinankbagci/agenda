/**
 * Year in review (SPEC 4.6). PURE: heatmap of focused minutes per day, totals, best streaks,
 * deadlines met, everything watched / read with ratings, energy & mood by month.
 * "Focused minutes" = time recorded on goals: done/partial sessions (Focus Mode writes into them)
 * plus linked log entries.
 */
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { BacklogItem, CheckIn, Goal, GoalCategory, ISODate, LogEntry, Session } from '../db/types'
import { countedMinutes } from './planner'
import { streak } from './progress'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const isWork = (s: Session) => s.kind === 'goal' || s.kind === 'review'
const inYear = (date: ISODate, year: number) => date.startsWith(`${year}-`)

/** Years that have anything to show, newest first (always includes `currentYear`). */
export function yearsWithData(sessions: readonly Session[], logs: readonly LogEntry[], checkIns: readonly CheckIn[], currentYear: number): number[] {
  const ys = new Set<number>([currentYear])
  for (const s of sessions) if (isWork(s) && (s.status === 'done' || s.status === 'partial')) ys.add(Number(s.date.slice(0, 4)))
  for (const l of logs) ys.add(Number(l.date.slice(0, 4)))
  for (const c of checkIns) ys.add(Number(c.date.slice(0, 4)))
  return [...ys].sort((a, b) => b - a)
}

/** Focused minutes per day of the year. */
export function minutesByDay(year: number, sessions: readonly Session[], logs: readonly LogEntry[]): Map<ISODate, number> {
  const m = new Map<ISODate, number>()
  const add = (d: ISODate, n: number) => n > 0 && m.set(d, (m.get(d) ?? 0) + n)
  for (const s of sessions) if (isWork(s) && inYear(s.date, year)) add(s.date, countedMinutes(s))
  for (const l of logs) if (l.minutes && inYear(l.date, year)) add(l.date, l.minutes)
  return m
}

/** Heatmap levels: 0 nothing, 1 < 30 min, 2 < 1 h, 3 < 2 h, 4 ≥ 2 h. */
export const LEVELS = [0, 1, 30, 60, 120] as const
export const levelOf = (minutes: number) => (minutes <= 0 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4)

export interface HeatCell {
  /** undefined = padding outside the year */
  date?: ISODate
  minutes: number
  level: 0 | 1 | 2 | 3 | 4
}

/** GitHub-style grid: one column per week (Monday first), 7 rows, padded at both ends. */
export function heatmapWeeks(year: number, byDay: ReadonlyMap<ISODate, number>): HeatCell[][] {
  const first = parseISO(`${year}-01-01`)
  const last = `${year}-12-31`
  const start = startOfWeek(first, { weekStartsOn: 1 })
  const weeks: HeatCell[][] = []
  for (let w = start; iso(w) <= last; w = addDays(w, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = iso(addDays(w, i))
        if (!inYear(date, year)) return { minutes: 0, level: 0 as const }
        const minutes = Math.round(byDay.get(date) ?? 0)
        return { date, minutes, level: levelOf(minutes) as HeatCell['level'] }
      }),
    )
  }
  return weeks
}

export interface YearTotals {
  minutes: number
  activeDays: number
  /** Longest run of consecutive days with any focused time. */
  longestRun: number
  sessionsDone: number
  perGoal: { goalId: string; name: string; color: string; category: GoalCategory; minutes: number }[]
  perCategory: { category: GoalCategory; minutes: number }[]
}

export function yearTotals(year: number, goals: readonly Goal[], sessions: readonly Session[], logs: readonly LogEntry[]): YearTotals {
  const byDay = minutesByDay(year, sessions, logs)
  const days = [...byDay.keys()].sort()
  let longestRun = 0
  let run = 0
  days.forEach((d, i) => {
    run = i > 0 && differenceInCalendarDays(parseISO(d), parseISO(days[i - 1]!)) === 1 ? run + 1 : 1
    longestRun = Math.max(longestRun, run)
  })

  const perGoalMap = new Map<string, number>()
  for (const s of sessions) if (isWork(s) && s.goalId && inYear(s.date, year)) perGoalMap.set(s.goalId, (perGoalMap.get(s.goalId) ?? 0) + countedMinutes(s))
  for (const l of logs) if (l.goalId && l.minutes && inYear(l.date, year)) perGoalMap.set(l.goalId, (perGoalMap.get(l.goalId) ?? 0) + l.minutes)
  const perGoal = [...perGoalMap]
    .map(([goalId, minutes]) => {
      const g = goals.find((x) => x.id === goalId)
      return { goalId, name: g?.name ?? 'Deleted goal', color: g?.color ?? '#888', category: g?.category ?? ('Other' as GoalCategory), minutes: Math.round(minutes) }
    })
    .filter((g) => g.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
  const cats = new Map<GoalCategory, number>()
  for (const g of perGoal) cats.set(g.category, (cats.get(g.category) ?? 0) + g.minutes)

  return {
    minutes: Math.round([...byDay.values()].reduce((a, b) => a + b, 0)),
    activeDays: byDay.size,
    longestRun,
    sessionsDone: sessions.filter((s) => isWork(s) && s.status === 'done' && inYear(s.date, year)).length,
    perGoal,
    perCategory: [...cats].map(([category, minutes]) => ({ category, minutes })).sort((a, b) => b.minutes - a.minutes || a.category.localeCompare(b.category)),
  }
}

/** Best streak per goal (as of the end of the year, or today in the current year). */
export function bestStreaks(year: number, goals: readonly Goal[], sessions: readonly Session[], logs: readonly LogEntry[], today: ISODate) {
  const asOf = today < `${year}-12-31` ? today : `${year}-12-31`
  return goals
    .filter((g) => !g.oneOff)
    .map((g) => ({ goal: g, s: streak(g, sessions, asOf, logs) }))
    .filter((x) => x.s && x.s.best > 0)
    .map((x) => ({ goalId: x.goal.id, name: x.goal.name, unit: x.s!.unit, best: x.s!.best }))
    .sort((a, b) => b.best - a.best || a.name.localeCompare(b.name))
}

export interface DeadlineResult {
  goalId: string
  name: string
  deadline: ISODate
  met: boolean
  task: boolean
}

/**
 * Deadlines that fell in the year and have passed: met if the planned hours were done before
 * the deadline (or, for a one-off task, it was finished in time).
 */
export function deadlinesMet(year: number, goals: readonly Goal[], sessions: readonly Session[], logs: readonly LogEntry[], today: ISODate): DeadlineResult[] {
  return goals
    .filter((g) => g.type === 'deadline' && g.deadline && inYear(g.deadline, year) && g.deadline <= today)
    .map((g) => {
      const before = (d: ISODate) => d < g.deadline!
      const done =
        sessions.filter((s) => s.goalId === g.id && s.kind === 'goal' && before(s.date)).reduce((m, s) => m + countedMinutes(s), 0) +
        logs.filter((l) => l.goalId === g.id && before(l.date)).reduce((m, l) => m + (l.minutes ?? 0), 0)
      const met = g.oneOff ? !!g.completedAt && iso(new Date(g.completedAt)) < g.deadline! : done >= (g.totalHours ?? 0) * 60
      const shown = g.oneOff ? iso(addDays(parseISO(g.deadline!), -1)) : g.deadline!
      return { goalId: g.id, name: g.name, deadline: shown, met, task: !!g.oneOff }
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
}

export interface Consumed {
  title: string
  list: 'watch' | 'read'
  type: string
  rating?: number
  date: ISODate
  note?: string
}

/**
 * Everything watched and read in the year: finished backlog items (with their rating) plus
 * "watched"/"read" log entries that didn't come from a finished backlog item.
 */
export function watchedAndRead(year: number, items: readonly BacklogItem[], logs: readonly LogEntry[]): Consumed[] {
  const finished = items
    .filter((i) => i.status === 'finished' && i.finishedAt && inYear(iso(new Date(i.finishedAt)), year))
    .map((i) => ({ title: i.title, list: i.list, type: i.type, rating: i.rating, date: iso(new Date(i.finishedAt!)), note: i.note }))
  const fromItems = new Set(finished.map((f) => `${f.list}|${f.title.toLowerCase()}|${f.date}`))
  const logged = logs
    .filter((l) => (l.type === 'watched' || l.type === 'read') && inYear(l.date, year))
    .filter((l) => !fromItems.has(`${l.type === 'watched' ? 'watch' : 'read'}|${l.title.toLowerCase()}|${l.date}`))
    .map((l) => ({ title: l.title, list: (l.type === 'watched' ? 'watch' : 'read') as Consumed['list'], type: l.type, date: l.date, note: l.note }))
  return [...finished, ...logged].sort((a, b) => b.date.localeCompare(a.date))
}

/** Average energy and mood per month (1–12); months without check-ins are undefined. */
export function moodByMonth(year: number, checkIns: readonly CheckIn[]): { month: number; energy?: number; mood?: number; count: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const prefix = `${year}-${String(i + 1).padStart(2, '0')}-`
    const cs = checkIns.filter((c) => c.date.startsWith(prefix))
    const avg = (k: 'energy' | 'mood') => (cs.length ? Math.round((cs.reduce((m, c) => m + c[k], 0) / cs.length) * 10) / 10 : undefined)
    return { month: i + 1, energy: avg('energy'), mood: avg('mood'), count: cs.length }
  })
}
