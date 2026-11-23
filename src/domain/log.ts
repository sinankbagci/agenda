/**
 * Activity log (SPEC 4.3), evening check-in (4.1c) and backlog lists (4.5). PURE.
 *
 * A log entry linked to a goal counts toward it: its minutes are added to the goal's done
 * time (planner + progress) without occupying any time slot; for recurring goals an entry
 * counts as one session that week; for book goals its `amount` is pages read.
 */
import type { BacklogItem, BacklogList, BacklogType, CheckIn, Goal, ISODate, LogEntry, NewRow, Session } from '../db/types'
import type { Check } from './setupValidation'

export const LOG_TYPES = [
  { value: 'read', label: 'Read', icon: '📖' },
  { value: 'watched', label: 'Watched', icon: '🎬' },
  { value: 'exercise', label: 'Exercise', icon: '🏃' },
  { value: 'study', label: 'Study', icon: '📚' },
  { value: 'other', label: 'Other', icon: '✏️' },
] as const
export type LogType = (typeof LOG_TYPES)[number]['value']
export const logTypeIcon = (t: string) => LOG_TYPES.find((x) => x.value === t)?.icon ?? '✏️'

export function validateLogEntry(e: NewRow<LogEntry>, goals: readonly Goal[], today: ISODate): Check {
  const c: Check = { errors: [], warnings: [] }
  if (!e.title.trim()) c.errors.push('Say what you did.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) c.errors.push('Pick a date.')
  else if (e.date > today) c.errors.push('You can only log things that already happened.')
  if (e.minutes !== undefined && !(Number.isInteger(e.minutes) && e.minutes > 0 && e.minutes <= 24 * 60)) c.errors.push('Minutes must be a whole number between 1 and 1440.')
  if (e.amount !== undefined && !(Number.isInteger(e.amount) && e.amount > 0)) c.errors.push('The amount must be a whole number above 0.')
  const goal = e.goalId ? goals.find((g) => g.id === e.goalId) : undefined
  if (e.goalId && !goal) c.errors.push('That goal no longer exists.')
  if (goal && goal.type !== 'book' && e.minutes === undefined) c.warnings.push(`Add the minutes, or it won’t count toward “${goal.name}”.`)
  if (goal?.type === 'book' && e.minutes === undefined && e.amount === undefined) c.warnings.push('Add minutes or pages so it counts toward the book.')
  return c
}

/** Drop empty optionals and trim before saving. */
export function normalizeLogEntry(e: NewRow<LogEntry>): NewRow<LogEntry> {
  const out: NewRow<LogEntry> = { date: e.date, type: e.type, title: e.title.trim() }
  if (e.minutes !== undefined && Number.isFinite(e.minutes)) out.minutes = e.minutes
  if (e.amount !== undefined && Number.isFinite(e.amount)) out.amount = e.amount
  if (e.note?.trim()) out.note = e.note.trim()
  if (e.goalId) out.goalId = e.goalId
  return out
}

/** Minutes logged for a goal (optionally only on some dates). */
export function loggedMinutes(goalId: string, logs: readonly LogEntry[] | undefined, inRange?: (date: ISODate) => boolean): number {
  return (logs ?? []).filter((l) => l.goalId === goalId && (!inRange || inRange(l.date))).reduce((m, l) => m + (l.minutes ?? 0), 0)
}

/** Log entries of a goal that count as a session (recurring goals: one entry = one session). */
export function loggedSessions(goalId: string, logs: readonly LogEntry[] | undefined, inRange?: (date: ISODate) => boolean): number {
  return (logs ?? []).filter((l) => l.goalId === goalId && (l.minutes ?? 0) > 0 && (!inRange || inRange(l.date))).length
}

/** Pages a book goal reaches after logging `amount` pages (capped at the book). */
export const pagesAfterLog = (goal: Pick<Goal, 'pagesDone' | 'totalPages'>, amount: number) =>
  Math.min(goal.totalPages ?? Infinity, (goal.pagesDone ?? 0) + amount)

// ---------- Evening check-in ----------

export function validateCheckIn(c: Partial<CheckIn>): string | undefined {
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
  if (!ok(c.energy) || !ok(c.mood)) return 'Pick your energy and mood (1–5).'
  return undefined
}

/**
 * Show the check-in prompt on Today once the last planned item is over (SPEC 4.1c), or from
 * 20:00 if nothing is planned — unless today's check-in exists or was dismissed.
 */
export function shouldPromptCheckIn(todays: readonly Pick<Session, 'end' | 'kind'>[], nowMin: number, hasCheckIn: boolean, dismissed: boolean): boolean {
  if (hasCheckIn || dismissed) return false
  const planned = todays.filter((s) => s.kind !== 'travel')
  if (!planned.length) return nowMin >= 20 * 60
  const lastEnd = Math.max(...planned.map((s) => toMin(s.end)))
  return nowMin >= lastEnd
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

// ---------- Log screen grouping ----------

export interface LogDay {
  date: ISODate
  entries: LogEntry[]
  checkIn?: CheckIn
  minutes: number
}

/** Entries and check-ins grouped by day, newest first. */
export function groupByDay(entries: readonly LogEntry[], checkIns: readonly CheckIn[]): LogDay[] {
  const days = new Map<ISODate, LogDay>()
  const day = (d: ISODate) => days.get(d) ?? days.set(d, { date: d, entries: [], minutes: 0 }).get(d)!
  for (const e of entries) {
    const d = day(e.date)
    d.entries.push(e)
    d.minutes += e.minutes ?? 0
  }
  for (const c of checkIns) day(c.date).checkIn = c
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
}

// ---------- Backlog ----------

export const BACKLOG_TYPES: Record<BacklogList, BacklogType[]> = {
  watch: ['movie', 'series', 'course', 'other'],
  read: ['book', 'article', 'course', 'other'],
}
export const BACKLOG_TYPE_LABEL: Record<BacklogType, string> = { movie: 'Movie', series: 'Series', book: 'Book', article: 'Article', course: 'Course', other: 'Other' }

export function validateBacklogItem(i: Pick<BacklogItem, 'title' | 'link'>): Check {
  const c: Check = { errors: [], warnings: [] }
  if (!i.title.trim()) c.errors.push('Give it a title.')
  if (i.link && !isHttpUrl(i.link)) c.errors.push('The link must start with http:// or https://.')
  return c
}

export const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** In progress first, then to do (newest first); finished last (most recent first). */
export function sortBacklog(items: readonly BacklogItem[]): BacklogItem[] {
  const rank = { inProgress: 0, todo: 1, finished: 2 } as const
  return [...items].sort((a, b) => rank[a.status] - rank[b.status] || (b.finishedAt ?? b.addedAt) - (a.finishedAt ?? a.addedAt))
}

export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

/**
 * Finish a backlog item (SPEC 4.5): rating + note, and the log entry it creates
 * ("Watched Dune — ★★★★☆ great sound").
 */
export function finishBacklogItem(
  item: BacklogItem,
  rating: 1 | 2 | 3 | 4 | 5,
  note: string,
  now: number,
  today: ISODate,
): { item: BacklogItem; logEntry: NewRow<LogEntry> } {
  const n = note.trim()
  const updated: BacklogItem = { ...item, status: 'finished', rating, finishedAt: now }
  if (n) updated.note = n
  const logEntry: NewRow<LogEntry> = {
    date: today,
    type: item.list === 'watch' ? 'watched' : 'read',
    title: item.title,
    note: n ? `${stars(rating)} — ${n}` : stars(rating),
  }
  return { item: updated, logEntry }
}
