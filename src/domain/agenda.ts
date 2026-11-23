/**
 * Pure helpers that turn stored data into what the Today / Week / Month views show.
 * No React, no Dexie — screens pass in the rows they loaded.
 */
import { addDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import type { FixedBlock, Goal, ISODate, Location, Session, SessionStatus, Topic, Weekday } from '../db/types'
import { countedMinutes } from './planner'
import { fixedOccursOn } from './freeSlots'
import { formatDuration, toMinutes } from './time'

export type ItemKind = 'fixed' | 'goal' | 'review' | 'meal' | 'travel'

export interface TimelineItem {
  /** Session id, or `fixed:<blockId>`. */
  id: string
  kind: ItemKind
  /** Minutes since midnight. */
  start: number
  end: number
  title: string
  subtitle: string
  color?: string
  icon?: string
  status?: SessionStatus
  locked?: boolean
  goalId?: string
}

export interface DayData {
  sessions: readonly Session[]
  fixedBlocks: readonly FixedBlock[]
  goals: readonly Goal[]
  locations: readonly Location[]
  topics?: readonly Topic[]
}

/** "Rings" / "Groups, Subgroups" for a session's topics (unknown ids are skipped). */
export function topicNames(ids: readonly string[] | undefined, topics: readonly Topic[] | undefined): string {
  return (ids ?? []).map((id) => topics?.find((t) => t.id === id)?.name).filter(Boolean).join(', ')
}

const KIND_ORDER: Record<ItemKind, number> = { fixed: 0, meal: 1, travel: 2, review: 3, goal: 4 }

export const weekdayOfIso = (date: ISODate) => parseISO(date).getDay() as Weekday

/** Everything on a day, in time order: fixed program + saved sessions. */
export function dayTimeline(date: ISODate, data: DayData): TimelineItem[] {
  const place = (id?: string) => (id ? data.locations.find((l) => l.id === id)?.name : undefined)
  const goal = (id?: string) => data.goals.find((g) => g.id === id)
  const items: TimelineItem[] = []

  for (const b of data.fixedBlocks) {
    if (!fixedOccursOn(b, date, weekdayOfIso(date))) continue
    const start = toMinutes(b.start)
    const end = toMinutes(b.end)
    items.push({
      id: `fixed:${b.id}`,
      kind: 'fixed',
      start,
      end,
      title: b.title,
      subtitle: [formatDuration(end - start), place(b.locationId)].filter(Boolean).join(' · '),
      locked: true,
    })
  }

  for (const s of data.sessions) {
    if (s.date !== date) continue
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    const len = formatDuration(end - start)
    const base = { id: s.id, start, end, status: s.status }
    switch (s.kind) {
      case 'goal':
      case 'review': {
        const g = goal(s.goalId)
        const name = g?.name ?? 'Deleted goal'
        const topics = topicNames(s.topicIds, data.topics)
        // "Algebra: Rings" (SPEC 3.6); spaced review "Review: Algebra — Rings"; final review lists all topics below
        const title =
          s.kind === 'review' ? (s.spacedReview && topics ? `Review: ${name} — ${topics}` : `Review: ${name}`) : topics ? `${name}: ${topics}` : name
        items.push({
          ...base,
          kind: s.kind,
          title,
          subtitle: [len, place(s.locationId), s.kind === 'review' && !s.spacedReview && topics ? topics : undefined].filter(Boolean).join(' · '),
          color: g?.color,
          icon: g?.icon,
          goalId: s.goalId,
        })
        break
      }
      case 'meal':
        items.push({ ...base, kind: 'meal', title: s.label ?? 'Meal', subtitle: [len, place(s.locationId)].filter(Boolean).join(' · ') })
        break
      case 'travel':
        items.push({
          ...base,
          kind: 'travel',
          title: `${place(s.fromLocationId) ?? '?'} → ${place(s.toLocationId) ?? '?'}`,
          subtitle: len,
        })
        break
    }
  }

  return items.sort((a, b) => a.start - b.start || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.end - b.end)
}

/**
 * What's happening now and what's next (only meaningful for today).
 * Travel counts — "leave for the gym" is exactly what you want to see next.
 */
export function nowAndNext(items: readonly TimelineItem[], nowMin: number): { current?: string; next?: string } {
  const open = items.filter((i) => i.status !== 'done' && i.status !== 'skipped')
  const current = open.find((i) => i.start <= nowMin && nowMin < i.end)
  const next = open.find((i) => i.start > nowMin && i.id !== current?.id)
  return { current: current?.id, next: next?.id }
}

export interface DayProgress {
  /** Goal + review sessions. */
  total: number
  done: number
  plannedMinutes: number
  doneMinutes: number
  /** 0–1, by minutes. */
  ratio: number
}

export function dayProgress(sessions: readonly Session[]): DayProgress {
  const work = sessions.filter((s) => s.kind === 'goal' || s.kind === 'review')
  const plannedMinutes = work.reduce((m, s) => m + toMinutes(s.end) - toMinutes(s.start), 0)
  const doneMinutes = work.reduce((m, s) => m + countedMinutes(s), 0)
  return {
    total: work.length,
    done: work.filter((s) => s.status === 'done').length,
    plannedMinutes,
    doneMinutes,
    ratio: plannedMinutes ? Math.min(1, doneMinutes / plannedMinutes) : 0,
  }
}

/** Monday-first week containing `date`. */
export function weekDates(date: ISODate): ISODate[] {
  const monday = startOfWeek(parseISO(date), { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
}

/** Whole hours to show in the week grid: covers every item, at least 08–22. */
export function hourRange(items: readonly Pick<TimelineItem, 'start' | 'end'>[]): { from: number; to: number } {
  let from = 8
  let to = 22
  for (const i of items) {
    from = Math.min(from, Math.floor(i.start / 60))
    to = Math.max(to, Math.ceil(i.end / 60))
  }
  return { from: Math.max(0, from), to: Math.min(24, to) }
}

/** 6 × 7 Monday-first grid for a month ('yyyy-MM'), padded with neighbouring days. */
export function monthGrid(month: string): { date: ISODate; inMonth: boolean }[] {
  const first = startOfMonth(parseISO(`${month}-01`))
  const start = startOfWeek(first, { weekStartsOn: 1 })
  const last = format(endOfMonth(first), 'yyyy-MM-dd')
  const firstIso = format(first, 'yyyy-MM-dd')
  return Array.from({ length: 42 }, (_, i) => {
    const date = format(addDays(start, i), 'yyyy-MM-dd')
    return { date, inMonth: date >= firstIso && date <= last }
  })
}

/** Planned goal minutes on a day relative to that day's cap (for the month's load bar). */
export function dayLoad(sessions: readonly Session[], capHours: number): { minutes: number; ratio: number } {
  const minutes = sessions
    .filter((s) => s.kind === 'goal' || s.kind === 'review')
    .reduce((m, s) => m + toMinutes(s.end) - toMinutes(s.start), 0)
  return { minutes, ratio: capHours > 0 ? Math.min(1, minutes / (capHours * 60)) : 0 }
}

export interface DeadlineMarker {
  goalId: string
  name: string
  color: string
  kind: 'deadline' | 'review' | 'book'
}

/** Deadline / review-day / book-target markers keyed by date (active goals only). */
export function deadlineMarkers(goals: readonly Goal[]): Map<ISODate, DeadlineMarker[]> {
  const out = new Map<ISODate, DeadlineMarker[]>()
  const add = (date: ISODate, m: DeadlineMarker) => out.set(date, [...(out.get(date) ?? []), m])
  for (const g of goals) {
    if (!g.active || !g.deadline) continue
    if (g.type === 'deadline') {
      add(g.deadline, { goalId: g.id, name: g.name, color: g.color, kind: 'deadline' })
      for (let i = 1; i <= (g.reviewDays ?? 0); i++) {
        add(format(addDays(parseISO(g.deadline), -i), 'yyyy-MM-dd'), { goalId: g.id, name: g.name, color: g.color, kind: 'review' })
      }
    } else if (g.type === 'book') {
      add(g.deadline, { goalId: g.id, name: g.name, color: g.color, kind: 'book' })
    }
  }
  return out
}
