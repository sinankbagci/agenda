/**
 * Topics of deadline goals (SPEC 3.6): splitting a goal's hours across topics, labelling
 * sessions, spaced review after a topic is done, and the order of the final review. PURE.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { ISODate, Session, Topic } from '../db/types'

export const WEAK_FACTOR = 1.5
/** Days after a topic is marked done: short reviews (SPEC: e.g. +2, +5, +10). */
export const REVIEW_INTERVALS = [2, 5, 10] as const
/** Spaced reviews are short: 20 min, or 15 if 20 doesn't fit. */
export const REVIEW_MINUTES = { ideal: 20, min: 15 } as const
/** A topic is only named on a session if it covers at least this many of its minutes. */
export const MIN_LABEL_MINUTES = 10

export const effectiveWeight = (t: Pick<Topic, 'weight' | 'weak'>) => Math.max(0, t.weight) * (t.weak ? WEAK_FACTOR : 1)

const byOrder = (a: Topic, b: Topic) => a.order - b.order

const minutes = (s: Pick<Session, 'start' | 'end'>) => {
  const [sh, sm] = s.start.split(':').map(Number)
  const [eh, em] = s.end.split(':').map(Number)
  return eh! * 60 + em! - (sh! * 60 + sm!)
}

/**
 * Minutes already put into each topic by stored study sessions (done / partial actual minutes,
 * or frozen planned time). A session labelled with several topics splits evenly.
 */
export function workedByTopic(sessions: readonly Session[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of sessions) {
    if (s.kind !== 'goal' || !s.topicIds?.length) continue
    const m =
      s.status === 'done' ? s.actualMinutes ?? minutes(s) : s.status === 'partial' ? s.actualMinutes ?? 0 : s.status === 'planned' && s.frozen ? minutes(s) : 0
    for (const id of s.topicIds) out.set(id, (out.get(id) ?? 0) + m / s.topicIds.length)
  }
  return out
}

/**
 * Label planned study sessions (in time order) with the topics they cover.
 * Topics are filled in list order; each open topic needs its weighted share of the goal's total
 * minus what was already worked on it; done topics get nothing new. Needs are scaled to the
 * minutes actually planned, so the labels always cover every session. A session that crosses
 * from one topic to the next gets both.
 */
export function assignTopics(
  topics: readonly Topic[],
  planned: readonly Pick<Session, 'id' | 'start' | 'end' | 'date'>[],
  totalMinutes: number,
  worked: ReadonlyMap<string, number>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const open = topics.filter((t) => !t.done).sort(byOrder)
  if (!open.length || !planned.length) return out

  const wAll = topics.reduce((s, t) => s + effectiveWeight(t), 0) || 1
  let need = open.map((t) => Math.max(0, (totalMinutes * effectiveWeight(t)) / wAll - (worked.get(t.id) ?? 0)))
  if (need.every((n) => n <= 0)) need = open.map((t) => effectiveWeight(t) || 1) // behind schedule: just use the weights
  const plannedTotal = planned.reduce((s, p) => s + minutes(p), 0)
  const needSum = need.reduce((a, b) => a + b, 0)
  need = need.map((n) => (n / needSum) * plannedTotal)

  const sorted = [...planned].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  let i = 0
  let leftInTopic = need[0]!
  for (const s of sorted) {
    let leftInSession = minutes(s)
    const portions = new Map<string, number>()
    while (leftInSession > 0.5 && i < open.length) {
      const take = Math.min(leftInSession, leftInTopic)
      portions.set(open[i]!.id, (portions.get(open[i]!.id) ?? 0) + take)
      leftInSession -= take
      leftInTopic -= take
      // move on once a topic is (practically) covered — but never past the last one
      if (leftInTopic <= 0.5 && i < open.length - 1) {
        i++
        leftInTopic = need[i]!
      } else if (leftInTopic <= 0.5) break
    }
    // only name topics that get a real part of the session (a few minutes of overlap is noise)
    const ids = [...portions].filter(([, m]) => m >= MIN_LABEL_MINUTES).map(([id]) => id)
    if (!ids.length) ids.push(portions.size ? [...portions].sort((a, b) => b[1] - a[1])[0]![0] : open[open.length - 1]!.id)
    out.set(s.id, ids)
  }
  return out
}

/**
 * Dates for the spaced reviews of a topic that's done: doneDate + 2, + 5, + 10 days.
 * `alreadyHave` reviews (done / partial / kept) are skipped; a review whose day has passed moves
 * to `from`; dates stay strictly increasing and must be before `before` (the first final review
 * day, or the deadline).
 */
export function spacedReviewDates(doneDate: ISODate, alreadyHave: number, from: ISODate, before: ISODate): ISODate[] {
  const out: ISODate[] = []
  let prev = ''
  for (let k = alreadyHave; k < REVIEW_INTERVALS.length; k++) {
    let d = format(addDays(parseISO(doneDate), REVIEW_INTERVALS[k]!), 'yyyy-MM-dd')
    if (d < from) d = from
    if (prev && d <= prev) d = format(addDays(parseISO(prev), 1), 'yyyy-MM-dd')
    if (d >= before) break
    out.push(d)
    prev = d
  }
  return out
}

/** Final review covers every topic, weak ones first, then list order. */
export function finalReviewOrder(topics: readonly Topic[]): string[] {
  return [...topics].sort((a, b) => Number(b.weak) - Number(a.weak) || a.order - b.order).map((t) => t.id)
}

/** "3 / 6 topics done" */
export function topicProgress(topics: readonly Topic[]): { done: number; total: number } {
  return { done: topics.filter((t) => t.done).length, total: topics.length }
}

export const isSpacedReviewOf = (s: Session, topicId: string) => s.kind === 'review' && !!s.spacedReview && s.topicIds?.[0] === topicId

/** Spaced reviews of a topic that count as had (done or partly done). */
export function reviewsHad(topicId: string, sessions: readonly Session[]): number {
  return sessions.filter((s) => isSpacedReviewOf(s, topicId) && (s.status === 'done' || s.status === 'partial')).length
}

/** Days between two ISO dates (b − a). */
export const daysBetween = (a: ISODate, b: ISODate) => differenceInCalendarDays(parseISO(b), parseISO(a))

export function validateTopicName(name: string, existing: readonly Topic[], ignoreId?: string): string | undefined {
  const n = name.trim()
  if (!n) return 'Give the topic a name.'
  if (existing.some((t) => t.id !== ignoreId && t.name.trim().toLowerCase() === n.toLowerCase())) return 'That topic is already in the list.'
  return undefined
}

export function validateWeight(w: number): string | undefined {
  if (!Number.isFinite(w) || w <= 0 || w > 10) return 'Weight must be between 0 and 10 (1 = normal).'
  return undefined
}
