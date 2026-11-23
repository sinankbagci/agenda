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

/** One free-time override per day in the range. */
export function extraTimeOverrides(d: ExtraTimeDraft): Omit<AvailabilityOverride, 'id'>[] {
  const out: Omit<AvailabilityOverride, 'id'>[] = []
  for (let date = d.from; date <= d.to; date = format(addDays(parseISO(date), 1), 'yyyy-MM-dd')) {
    const o: Omit<AvailabilityOverride, 'id'> = { date, kind: 'free', start: d.start, end: d.end, energy: d.energy }
    if (d.boostGoalIds.length) o.boostGoalIds = [...d.boostGoalIds]
    out.push(o)
  }
  return out
}
