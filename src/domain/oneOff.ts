/**
 * One-off additions to a day ("+ Add"): an event (locked one-off fixed block), a goal session
 * placed at a chosen time (pinned), or extra free time over a date range. PURE.
 */
import { addDays, format, parseISO } from 'date-fns'
import type { AvailabilityOverride, Energy, FixedBlock, Goal, ISODate, Session } from '../db/types'
import type { Check } from './setupValidation'
import { fixedOccursOn, weekdayOf } from './freeSlots'
import { daysUntil } from './goals'
import { isTime, toMinutes } from './time'

export interface EventDraft {
  title: string
  date: ISODate
  start: string
  end: string
  locationId?: string
}

export interface GoalSessionDraft {
  goalId: string
  date: ISODate
  start: string
  end: string
}

export interface ExtraTimeDraft {
  from: ISODate
  to: ISODate
  start: string
  end: string
  energy: Energy
  /** "Use it for" (optional). */
  boostGoalIds: string[]
}

export const MAX_EXTRA_DAYS = 31

function timeRange(c: Check, start: string, end: string) {
  if (!isTime(start) || !isTime(end)) c.errors.push('Enter a start and end time.')
  else if (toMinutes(end) <= toMinutes(start)) c.errors.push('The end time must be after the start time.')
}

function dateNotPast(c: Check, date: string, today: ISODate, label = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) c.errors.push(`Pick a ${label}.`)
  else if (daysUntil(date, today) < 0) c.errors.push(`The ${label} is in the past.`)
}

/**
 * What a new item would collide with on that day: fixed program and sessions that won't move
 * (done / partial / pinned / frozen). Ordinary planned sessions just get re-planned around it.
 */
export function overlapWarnings(
  date: ISODate,
  start: string,
  end: string,
  fixedBlocks: readonly FixedBlock[],
  sessions: readonly Session[],
  goals: readonly Goal[],
): string[] {
  if (!isTime(start) || !isTime(end) || toMinutes(end) <= toMinutes(start)) return []
  const s = toMinutes(start)
  const e = toMinutes(end)
  const hits = (a: string, b: string) => toMinutes(a) < e && s < toMinutes(b)
  const out: string[] = []
  const wd = weekdayOf(date)
  for (const b of fixedBlocks) {
    if (fixedOccursOn(b, date, wd) && hits(b.start, b.end)) out.push(`Overlaps “${b.title}” (${b.start}–${b.end}).`)
  }
  for (const x of sessions) {
    if (x.date !== date || (x.kind !== 'goal' && x.kind !== 'review')) continue
    const fixed = x.status !== 'planned' || x.frozen
    if (fixed && x.status !== 'skipped' && hits(x.start, x.end)) {
      const name = goals.find((g) => g.id === x.goalId)?.name ?? 'a session'
      out.push(`Overlaps “${name}” (${x.start}–${x.end}), which stays where it is.`)
    }
  }
  return out
}

export function validateEvent(d: EventDraft, today: ISODate): Check {
  const c: Check = { errors: [], warnings: [] }
  if (!d.title.trim()) c.errors.push('Give it a title.')
  dateNotPast(c, d.date, today)
  timeRange(c, d.start, d.end)
  return c
}

export function validateGoalSession(d: GoalSessionDraft, goals: readonly Goal[], today: ISODate): Check {
  const c: Check = { errors: [], warnings: [] }
  const goal = goals.find((g) => g.id === d.goalId)
  if (!goal) c.errors.push('Pick a goal.')
  dateNotPast(c, d.date, today)
  timeRange(c, d.start, d.end)
  if (goal && !goal.active) c.warnings.push(`“${goal.name}” is paused; this session still counts toward it.`)
  if (goal?.type === 'deadline' && goal.deadline && d.date >= goal.deadline) c.warnings.push(`That’s on or after the deadline of “${goal.name}”.`)
  return c
}

export function validateExtraTime(d: ExtraTimeDraft, today: ISODate): Check {
  const c: Check = { errors: [], warnings: [] }
  dateNotPast(c, d.from, today, 'first day')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.to)) c.errors.push('Pick a last day.')
  else if (d.to < d.from) c.errors.push('The last day must be on or after the first day.')
  else if (daysUntil(d.to, d.from) + 1 > MAX_EXTRA_DAYS) c.errors.push(`At most ${MAX_EXTRA_DAYS} days at a time.`)
  timeRange(c, d.start, d.end)
  return c
}

export function eventToFixedBlock(d: EventDraft): Omit<FixedBlock, 'id'> {
  const b: Omit<FixedBlock, 'id'> = { title: d.title.trim(), rule: { kind: 'once', date: d.date }, start: d.start, end: d.end, locked: true }
  if (d.locationId) b.locationId = d.locationId
  return b
}

/** A user-placed goal session: frozen so the planner keeps it, pinned so the UI can tell. */
export function pinnedSession(d: GoalSessionDraft, goal: Goal, id: string): Session {
  const s: Session = { id, kind: 'goal', goalId: d.goalId, date: d.date, start: d.start, end: d.end, status: 'planned', frozen: true, pinned: true }
  if (goal.locationId) s.locationId = goal.locationId
  return s
}

/** One free-time override per day in the range, sharing `groupId` so they list and edit as one. */
export function extraTimeOverrides(d: ExtraTimeDraft, groupId?: string): Omit<AvailabilityOverride, 'id'>[] {
  const out: Omit<AvailabilityOverride, 'id'>[] = []
  for (let date = d.from; date <= d.to; date = format(addDays(parseISO(date), 1), 'yyyy-MM-dd')) {
    const o: Omit<AvailabilityOverride, 'id'> = { date, kind: 'free', start: d.start, end: d.end, energy: d.energy }
    if (groupId) o.groupId = groupId
    if (d.boostGoalIds.length) o.boostGoalIds = [...d.boostGoalIds]
    out.push(o)
  }
  return out
}

// ---------- One-off tasks ("homework due tomorrow, 2 hours") ----------

export interface TaskDraft {
  title: string
  /** How long it takes, in minutes. */
  minutes: number
  /** Last day to work on it (inclusive). */
  doBy: ISODate
  category: Goal['category']
  focus: Goal['focus']
}

export const TASK_MAX_SESSION = 120

export function validateTask(d: TaskDraft, today: ISODate): Check {
  const c: Check = { errors: [], warnings: [] }
  if (!d.title.trim()) c.errors.push('Say what the task is.')
  if (!(Number.isInteger(d.minutes) && d.minutes >= 10 && d.minutes <= 12 * 60)) c.errors.push('How long: between 10 minutes and 12 hours.')
  dateNotPast(c, d.doBy, today, '“do it by” day')
  return c
}

/**
 * A task is a small deadline goal the planner fits in before it's due: deadline = the day after
 * "do it by", no review days, sessions of up to 2 h (shorter tasks: one session).
 */
export function taskToGoal(d: TaskDraft, color: string, createdAt: number): Omit<Goal, 'id'> {
  const maxSession = Math.min(d.minutes, TASK_MAX_SESSION)
  return {
    type: 'deadline',
    oneOff: true,
    name: d.title.trim(),
    category: d.category,
    color,
    icon: '📋',
    priority: 2,
    focus: d.focus,
    minSession: Math.min(maxSession, 30),
    maxSession,
    active: true,
    deadline: format(addDays(parseISO(d.doBy), 1), 'yyyy-MM-dd'),
    totalHours: d.minutes / 60,
    reviewDays: 0,
    createdAt,
  }
}

export function goalToTask(g: Goal): TaskDraft {
  return {
    title: g.name,
    minutes: Math.round((g.totalHours ?? 1) * 60),
    doBy: format(addDays(parseISO(g.deadline!), -1), 'yyyy-MM-dd'),
    category: g.category,
    focus: g.focus,
  }
}

/** "Do it by Tue 24 Nov" */
export const taskDoBy = (g: Pick<Goal, 'deadline'>) => (g.deadline ? format(addDays(parseISO(g.deadline), -1), 'EEE d MMM') : '')

/**
 * "When I'm done I complete that one-off goal": the task is finished, the session it was
 * finished in is done, and everything else still planned for it is dropped (the planner skips
 * completed tasks). Returns the session updates.
 */
export function finishTask(task: Goal, sessions: readonly Session[], fromSessionId: string | undefined, now: number): { goal: Partial<Goal>; done: Session[]; removeIds: string[] } {
  const mine = sessions.filter((s) => s.goalId === task.id && (s.kind === 'goal' || s.kind === 'review'))
  const from = mine.find((s) => s.id === fromSessionId)
  const done: Session[] = []
  if (from && (from.status === 'planned' || from.status === 'partial')) {
    done.push({ ...from, status: 'done', actualMinutes: from.actualMinutes && from.status === 'partial' ? Math.max(from.actualMinutes, minutes(from)) : minutes(from) })
  }
  const removeIds = mine.filter((s) => s.status === 'planned' && s.id !== from?.id).map((s) => s.id)
  return { goal: { completedAt: now }, done, removeIds }
}

const minutes = (s: Pick<Session, 'start' | 'end'>) => toMinutes(s.end) - toMinutes(s.start)

// ---------- Extra free time as one entry ----------

export interface OverrideGroup {
  key: string
  ids: string[]
  from: ISODate
  to: ISODate
  override: AvailabilityOverride
}

/** Overrides saved together (same groupId) are listed as one entry; others stay single. */
export function groupOverrides(overrides: readonly AvailabilityOverride[]): OverrideGroup[] {
  const groups = new Map<string, AvailabilityOverride[]>()
  for (const o of overrides) {
    const k = o.groupId ?? o.id
    groups.set(k, [...(groups.get(k) ?? []), o])
  }
  return [...groups]
    .map(([key, os]) => {
      const sorted = [...os].sort((a, b) => a.date.localeCompare(b.date))
      return { key, ids: sorted.map((o) => o.id), from: sorted[0]!.date, to: sorted.at(-1)!.date, override: sorted[0]! }
    })
    .sort((a, b) => a.from.localeCompare(b.from))
}
