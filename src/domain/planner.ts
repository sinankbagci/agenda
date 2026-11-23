/**
 * Planner v1 (SPEC §3, build step 6). PURE: `plan(state, today, options) → { sessions, warnings }`.
 * No Dexie, no Date.now(), no randomness — same input, same plan.
 *
 * Order of work:
 *  1. Free slots per day for the horizon (freeSlots.ts) — sleep, fixed program, meals, travel, buffers.
 *  2. Kept sessions (done / partial / skipped / frozen) stay where they are and use up their time.
 *  3. Review sessions of every deadline goal are reserved on the review day(s).
 *  4. Deadline goals, most urgent × highest priority first: remaining hours spread over the
 *     study days with a linear ramp (1.0 → 1.5), respecting min/max session length and caps.
 *  5. Recurring goals: N sessions per Mon–Sun week, spread out, honouring "no back-to-back days".
 *  6. Ongoing and book goals fill what's left up to their daily / weekly target.
 *  7. Shortfalls become warnings; a deadline shortfall comes with concrete options.
 *
 * Every placement picks the best-scoring spot (energy match, preferred time, variety, travel).
 * Daily caps (goal hours, demanding hours) are hard limits. Travel to a goal's place is added
 * around its session ("goals pull travel with them").
 */
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { Goal, ISODate, Rule, Session, Settings, Topic } from '../db/types'
import { buildDay, makeTravel, type DayLayout, type FreeSlot, type SlotInput } from './freeSlots'
import { intersect, subtract, type Range } from './ranges'
import { formatDuration, fromMinutes, toMinutes } from './time'
import { REVIEW_MINUTES, assignTopics, finalReviewOrder, isSpacedReviewOf, reviewsHad, spacedReviewDates, workedByTopic } from './topics'

// ---------- Public types ----------

export interface PlanState {
  setup: SlotInput
  caps: Pick<Settings, 'dailyCapWeekday' | 'dailyCapWeekend' | 'demandingCap'>
  goals: readonly Goal[]
  /** Every stored session (any date, any status). */
  sessions: readonly Session[]
  /** Topics of deadline goals (SPEC 3.6). */
  topics?: readonly Topic[]
}

export interface PlanOptions {
  /** First day to (re)generate. Defaults to `today`; use tomorrow to keep today frozen. */
  from?: ISODate
  /**
   * Minutes since midnight: nothing new is placed on the `from` day before this time
   * ("Re-plan today" in the afternoon mustn't fill the morning that already passed).
   */
  notBefore?: number
}

export type OverloadOption =
  | { kind: 'addFreeTime'; before: ISODate }
  | { kind: 'reduceHours'; toHours: number }
  | { kind: 'pauseGoal'; goalId: string; name: string }
  | { kind: 'acceptShortfall' }

export type PlanWarning =
  | { kind: 'deadlineShortfall'; goalId: string; shortfallMinutes: number; options: OverloadOption[]; message: string }
  | { kind: 'reviewNotPlaced'; goalId: string; date: ISODate; message: string }
  /** One per goal, listing every week (Monday) that came up short. */
  | { kind: 'recurringShortfall'; goalId: string; weeks: { weekStart: ISODate; placed: number }[]; message: string }
  | { kind: 'ongoingShortfall'; goalId: string; dates: ISODate[]; message: string }
  | { kind: 'goalTravelUnknown'; goalId: string; message: string }
  /** Setup problems from the free-slot builder, grouped by message. */
  | { kind: 'setup'; dates: ISODate[]; message: string }

export interface PlanResult {
  from: ISODate
  to: ISODate
  /** New planned sessions for [from, to]: goal, review, meal and travel. */
  sessions: Session[]
  warnings: PlanWarning[]
}

// ---------- Tunables ----------

export const STEP = 5 // all planned lengths are multiples of 5 minutes
export const HORIZON_DAYS = 42 // at least 6 weeks
export const RAMP_START = 1.0
export const RAMP_END = 1.5

const ENERGY_SCORE = {
  demanding: { high: 3, normal: 1, low: -2 },
  light: { high: 0, normal: 1, low: 2 },
} as const

// ---------- Helpers ----------

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const addDaysIso = (date: ISODate, n: number) => iso(addDays(parseISO(date), n))
const diffDays = (a: ISODate, b: ISODate) => differenceInCalendarDays(parseISO(a), parseISO(b))
const floor5 = (m: number) => Math.floor(m / STEP) * STEP
const ceil5 = (m: number) => Math.ceil(m / STEP) * STEP
const duration = (s: Pick<Session, 'start' | 'end'>) => toMinutes(s.end) - toMinutes(s.start)
export const bucketOf = (min: number) => (min < 12 * 60 ? 'morning' : min < 17 * 60 ? 'afternoon' : 'evening')
const isWeekend = (weekday: number) => weekday === 0 || weekday === 6

/** Minutes of a session that count toward its goal (done uses actual minutes if logged). */
export function countedMinutes(s: Session): number {
  if (s.status === 'done') return s.actualMinutes ?? duration(s)
  if (s.status === 'partial') return s.actualMinutes ?? 0
  return 0
}

/** Sessions the planner must not touch on dates it regenerates. */
const isKept = (s: Session) => s.status !== 'planned' || s.frozen

interface Placed extends Range {
  goalId?: string
}

interface Day {
  date: ISODate
  weekday: number
  layout: DayLayout
  free: FreeSlot[]
  capMin: number
  demandingCapMin: number
  goalMin: number
  demandingMin: number
  placed: Placed[]
}

interface Placement {
  start: number
  end: number
  travel: number
  slot: FreeSlot
  score: number
}

// ---------- The planner ----------

export function plan(state: PlanState, today: ISODate, options: PlanOptions = {}): PlanResult {
  const from = options.from ?? today
  const goals = state.goals.filter((g) => g.active)
  const bufferMin = state.setup.settings.bufferMin
  const travel = makeTravel(state.setup.travelTimes)
  const warnings: PlanWarning[] = []
  const out: Session[] = []
  const idCount = new Map<string, number>()
  const travelWarned = new Set<string>()

  // ----- horizon -----
  const deadlines = goals.filter((g) => g.deadline && (g.type === 'deadline' || g.type === 'book')).map((g) => g.deadline!)
  let to = addDaysIso(from, HORIZON_DAYS - 1)
  for (const d of deadlines) if (d > to) to = d
  const dayCount = diffDays(to, from) + 1

  // ----- 1. free slots -----
  const days: Day[] = []
  for (let i = 0; i < dayCount; i++) {
    const date = addDaysIso(from, i)
    const layout = buildDay(state.setup, date)
    days.push({
      date,
      weekday: layout.weekday,
      layout,
      free: layout.free.map((f) => ({ ...f })),
      capMin: Math.round((isWeekend(layout.weekday) ? state.caps.dailyCapWeekend : state.caps.dailyCapWeekday) * 60),
      demandingCapMin: Math.round(state.caps.demandingCap * 60),
      goalMin: 0,
      demandingMin: 0,
      placed: [],
    })
  }
  const dayByDate = new Map(days.map((d) => [d.date, d]))
  if (options.notBefore !== undefined && days[0]) {
    days[0].free = subtract(days[0].free, [{ start: 0, end: options.notBefore }])
  }

  // group setup warnings ("No room for Lunch" on every weekday → one warning)
  const setupGroups = new Map<string, ISODate[]>()
  for (const d of days) for (const w of d.layout.warnings) setupGroups.set(w.message, [...(setupGroups.get(w.message) ?? []), d.date])
  for (const [message, dates] of setupGroups) warnings.push({ kind: 'setup', dates, message })

  // Deterministic ids; never reuse an id a stored session already has (e.g. a done one).
  const taken = new Set(state.sessions.map((s) => s.id))
  const newId = (date: ISODate, kind: string, key: string) => {
    const base = `plan:${date}:${kind}:${key}`
    let n = idCount.get(base) ?? 0
    while (taken.has(`${base}:${n}`)) n++
    idCount.set(base, n + 1)
    return `${base}:${n}`
  }

  // meals and base travel become sessions so the day's timeline is complete — unless the
  // same block is already stored and kept on that day (never emit a duplicate)
  const keptBlocks = new Set(
    state.sessions
      .filter((s) => s.date >= from && isKept(s) && (s.kind === 'meal' || s.kind === 'travel'))
      .map((s) => (s.kind === 'meal' ? `${s.date}|meal|${s.mealId}` : `${s.date}|travel|${s.fromLocationId}|${s.toLocationId}|${s.start}`)),
  )
  for (const d of days) {
    for (const b of d.layout.blocks) {
      if (b.kind === 'meal' && keptBlocks.has(`${d.date}|meal|${b.mealId}`)) continue
      if (b.kind === 'travel' && keptBlocks.has(`${d.date}|travel|${b.fromId}|${b.toId}|${fromMinutes(b.start)}`)) continue
      if (b.kind === 'meal') {
        out.push({
          id: newId(d.date, 'meal', b.mealId),
          kind: 'meal',
          mealId: b.mealId,
          label: b.name,
          locationId: b.locationId,
          date: d.date,
          start: fromMinutes(b.start),
          end: fromMinutes(b.end),
          status: 'planned',
          frozen: false,
        })
      } else if (b.kind === 'travel') {
        out.push({
          id: newId(d.date, 'travel', `${b.fromId}-${b.toId}`),
          kind: 'travel',
          fromLocationId: b.fromId,
          toLocationId: b.toId,
          date: d.date,
          start: fromMinutes(b.start),
          end: fromMinutes(b.end),
          status: 'planned',
          frozen: false,
        })
      }
    }
  }

  // ----- 2. kept sessions occupy their time -----
  const occupy = (day: Day, r: Range, goal?: Goal, countLoad = true) => {
    day.free = subtract(day.free, [{ start: r.start - bufferMin, end: r.end + bufferMin }])
    day.placed.push({ start: r.start, end: r.end, goalId: goal?.id })
    if (goal && countLoad) {
      day.goalMin += r.end - r.start
      if (goal.focus === 'demanding') day.demandingMin += r.end - r.start
    }
  }
  for (const s of state.sessions) {
    if (s.date < from || !isKept(s) || s.status === 'skipped') continue
    const day = dayByDate.get(s.date)
    if (!day) continue
    const goal = s.goalId ? state.goals.find((g) => g.id === s.goalId) : undefined
    if (s.kind === 'goal' || s.kind === 'review' || s.kind === 'travel') {
      occupy(day, { start: toMinutes(s.start), end: toMinutes(s.end) }, goal, s.kind !== 'travel')
    }
  }

  // ----- placement machinery -----
  /** Category rules ("no Study after 23:00") as an allowed time window for this goal. */
  const categoryWindow = (goal: Goal): Range => {
    let lo = 0
    let hi = 1440
    for (const r of state.setup.rules as readonly Rule[]) {
      if (r.kind === 'noGoalAfter' && r.params.category === goal.category) hi = Math.min(hi, toMinutes(r.params.time))
      if (r.kind === 'noGoalBefore' && r.params.category === goal.category) lo = Math.max(lo, toMinutes(r.params.time))
    }
    return { start: lo, end: hi }
  }

  const travelFor = (goal: Goal, slot: FreeSlot): number => {
    if (!goal.locationId || !slot.locationId || goal.locationId === slot.locationId) return 0
    const t = travel(slot.locationId, goal.locationId)
    if (t === undefined) {
      if (!travelWarned.has(goal.id)) {
        travelWarned.add(goal.id)
        warnings.push({
          kind: 'goalTravelUnknown',
          goalId: goal.id,
          message: `No travel time set to the place of “${goal.name}”; assuming 0 min.`,
        })
      }
      return 0
    }
    return t
  }

  // "Skip" means "not this goal today": nothing new for that goal on a day it was skipped.
  const skippedOn = new Set(state.sessions.filter((s) => s.status === 'skipped' && s.goalId).map((s) => `${s.goalId}|${s.date}`))

  /** Best spot for exactly `len` minutes of `goal` on `day` (optionally only `within` some ranges), or undefined. */
  const bestSpot = (day: Day, goal: Goal, len: number, within?: readonly Range[]): Placement | undefined => {
    if (skippedOn.has(`${goal.id}|${day.date}`)) return undefined
    if (day.goalMin + len > day.capMin) return undefined
    if (goal.focus === 'demanding' && day.demandingMin + len > day.demandingCapMin) return undefined
    const win = categoryWindow(goal)
    let best: Placement | undefined
    for (const slot of within ? intersect(day.free, within) : day.free) {
      const t = travelFor(goal, slot)
      const starts = new Set<number>()
      starts.add(Math.max(slot.start + t, win.start)) // as early as possible
      starts.add(Math.min(slot.end - t, win.end) - len) // as late as possible
      for (const start of starts) {
        const end = start + len
        if (start - t < slot.start || end + t > slot.end || start < win.start || end > win.end) continue
        let score = ENERGY_SCORE[goal.focus][slot.energy]
        if (goal.preferredTime && bucketOf(start) === goal.preferredTime) score += 2
        if (day.placed.some((p) => p.goalId === goal.id && p.end > start - 60 && p.start < end + 60)) score -= 2
        score -= t / 15
        if (!best || score > best.score || (score === best.score && start < best.start)) best = { start, end, travel: t, slot, score }
      }
    }
    return best
  }

  /** Longest spot between `max` and `min` minutes (5-min steps). */
  const bestSpotUpTo = (day: Day, goal: Goal, max: number, min: number, within?: readonly Range[]): Placement | undefined => {
    for (let len = floor5(max); len >= min; len -= STEP) {
      const p = bestSpot(day, goal, len, within)
      if (p) return p
    }
    return undefined
  }

  const commit = (day: Day, goal: Goal, p: Placement, kind: 'goal' | 'review', extra?: Pick<Session, 'topicIds' | 'spacedReview'>) => {
    out.push({
      id: newId(day.date, kind, goal.id),
      kind,
      goalId: goal.id,
      locationId: goal.locationId,
      date: day.date,
      start: fromMinutes(p.start),
      end: fromMinutes(p.end),
      status: 'planned',
      frozen: false,
      ...extra,
    })
    if (p.travel > 0) {
      const there = { start: p.start - p.travel, end: p.start }
      const back = { start: p.end, end: p.end + p.travel }
      for (const [r, a, b] of [
        [there, p.slot.locationId!, goal.locationId!],
        [back, goal.locationId!, p.slot.locationId!],
      ] as const) {
        out.push({
          id: newId(day.date, 'travel', `${a}-${b}`),
          kind: 'travel',
          fromLocationId: a,
          toLocationId: b,
          date: day.date,
          start: fromMinutes(r.start),
          end: fromMinutes(r.end),
          status: 'planned',
          frozen: false,
        })
      }
    }
    occupy(day, { start: p.start - p.travel, end: p.end + p.travel }, undefined, false)
    day.placed.push({ start: p.start, end: p.end, goalId: goal.id })
    day.goalMin += p.end - p.start
    if (goal.focus === 'demanding') day.demandingMin += p.end - p.start
    return p.end - p.start
  }

  /** Minutes of a goal already done, or committed on days the planner isn't regenerating. */
  const committedMinutes = (goal: Goal, inRange?: (date: ISODate) => boolean, kinds: Session['kind'][] = ['goal']) => {
    let m = 0
    for (const s of state.sessions) {
      if (s.goalId !== goal.id || !kinds.includes(s.kind)) continue
      if (inRange && !inRange(s.date)) continue
      if (s.status === 'done' || s.status === 'partial') m += countedMinutes(s)
      else if (s.status === 'planned' && ((s.date >= today && s.date < from) || (s.date >= from && s.frozen))) m += duration(s)
    }
    return m
  }

  /** Usable minutes on a day for planning purposes (free time limited by the cap). */
  const usable = (d: Day) => Math.min(d.free.reduce((s, f) => s + f.end - f.start, 0), d.capMin - d.goalMin)

  // extra free time with "use it for": date → goals + the windows they may use
  const boosts = new Map<ISODate, { goalIds: Set<string>; windows: Range[] }>()
  for (const o of state.setup.availabilityOverrides) {
    if (o.kind !== 'free' || !o.start || !o.end || !o.boostGoalIds?.length || o.date < from || o.date > to) continue
    const b = boosts.get(o.date) ?? { goalIds: new Set<string>(), windows: [] }
    for (const id of o.boostGoalIds) b.goalIds.add(id)
    b.windows.push({ start: toMinutes(o.start), end: toMinutes(o.end) })
    boosts.set(o.date, b)
  }

  const topicsOf = (goalId: string) => (state.topics ?? []).filter((t) => t.goalId === goalId)

  // ----- 3 + 4. deadline goals -----
  const deadlineGoals = goals.filter((g) => g.type === 'deadline' && g.deadline && g.deadline > today)

  // reserve review days first
  for (const g of deadlineGoals) {
    const reviewDays = g.reviewDays ?? 0
    for (let i = reviewDays; i >= 1; i--) {
      const date = addDaysIso(g.deadline!, -i)
      const day = dayByDate.get(date)
      if (!day) continue
      const alreadyKept = state.sessions.some((s) => s.goalId === g.id && s.kind === 'review' && s.date === date && isKept(s))
      if (alreadyKept) continue
      const p = bestSpotUpTo(day, g, g.maxSession, g.minSession)
      const goalTopics = topicsOf(g.id)
      if (p) commit(day, g, p, 'review', goalTopics.length ? { topicIds: finalReviewOrder(goalTopics) } : undefined)
      else
        warnings.push({
          kind: 'reviewNotPlaced',
          goalId: g.id,
          date,
          message: `No room for the “${g.name}” review on ${format(parseISO(date), 'EEE d MMM')}.`,
        })
    }
  }

  // spaced review (SPEC 3.6): a topic marked done gets short reviews at +2, +5, +10 days,
  // as long as they land before the final review day(s)
  for (const g of deadlineGoals) {
    const before = addDaysIso(g.deadline!, -(g.reviewDays ?? 0))
    for (const t of topicsOf(g.id)) {
      if (!t.done || t.doneAt === undefined) continue
      const mine = (s: Session) => s.goalId === g.id && isSpacedReviewOf(s, t.id)
      const kept = state.sessions.filter((s) => mine(s) && s.date >= from && isKept(s) && s.status !== 'skipped').length
      const had = reviewsHad(t.id, state.sessions.filter((s) => s.date < from)) + kept
      for (const date of spacedReviewDates(iso(new Date(t.doneAt)), had, from, before)) {
        // if that day is full, try the next one or two (still before the final review)
        for (let shift = 0; shift <= 2; shift++) {
          const d = addDaysIso(date, shift)
          const day = dayByDate.get(d)
          if (!day || d >= before) break
          const p = bestSpotUpTo(day, g, REVIEW_MINUTES.ideal, REVIEW_MINUTES.min)
          if (p) {
            commit(day, g, p, 'review', { topicIds: [t.id], spacedReview: true })
            break
          }
        }
      }
    }
  }

  const studyDaysOf = (g: Goal) => days.filter((d) => d.date < addDaysIso(g.deadline!, -(g.reviewDays ?? 0)))
  const remainingOf = (g: Goal) => Math.max(0, Math.round((g.totalHours ?? 0) * 60) - committedMinutes(g))

  const urgency = new Map(
    deadlineGoals.map((g) => {
      const free = studyDaysOf(g).reduce((s, d) => s + Math.max(0, usable(d)), 0)
      const rem = remainingOf(g)
      return [g.id, rem === 0 ? 0 : free === 0 ? Infinity : rem / free]
    }),
  )
  const deadlineOrder = [...deadlineGoals].sort(
    (a, b) =>
      urgency.get(b.id)! * b.priority - urgency.get(a.id)! * a.priority ||
      a.deadline!.localeCompare(b.deadline!) ||
      a.name.localeCompare(b.name),
  )

  // "Extra free time … use it for X": deadline goals pull work into that time first (the user's
  // explicit choice wins over the ramp), so the other days get lighter; the total stays the same.
  const boostPlaced = new Map<string, number>()
  const boostedDays = new Map<string, Set<ISODate>>()
  for (const g of deadlineOrder) {
    let left = remainingOf(g)
    for (const day of studyDaysOf(g)) {
      const b = boosts.get(day.date)
      if (!b?.goalIds.has(g.id)) continue
      // several goals chosen for the same extra time share the day's cap fairly
      const sharers = [...b.goalIds].filter((id) => goals.some((x) => x.id === id && x.type !== 'recurring')).length
      let budget = floor5(day.capMin / Math.max(1, sharers))
      let guard = 0
      while (left >= STEP && budget >= g.minSession && guard++ < 20) {
        const len = Math.min(budget, Math.max(g.minSession, Math.min(g.maxSession, ceil5(left))))
        const p = bestSpotUpTo(day, g, len, g.minSession, b.windows)
        if (!p) break
        left -= commit(day, g, p, 'goal')
        budget -= p.end - p.start
        boostPlaced.set(g.id, (boostPlaced.get(g.id) ?? 0) + (p.end - p.start))
        boostedDays.set(g.id, (boostedDays.get(g.id) ?? new Set()).add(day.date))
      }
    }
  }

  for (const g of deadlineOrder) {
    let remaining = remainingOf(g) - (boostPlaced.get(g.id) ?? 0)
    if (remaining <= 0) continue
    const studyDays = studyDaysOf(g)
    // Ramp only over days with room for at least one session, so days without free time
    // (e.g. weekends) don't pile their share onto the next day. Days that already took
    // boosted work for this goal have had their share.
    const rampDays = studyDays.filter((d) => !boostedDays.get(g.id)?.has(d.date) && usable(d) >= g.minSession)
    const n = rampDays.length
    const weights = rampDays.map((_, i) => (n > 1 ? RAMP_START + ((RAMP_END - RAMP_START) * i) / (n - 1) : 1))
    const wSum = weights.reduce((a, b) => a + b, 0)
    // Work already done / kept on a ramp day counts toward that day's share, so a day you've
    // already studied doesn't get more on top ("Re-plan today" after finishing today's session).
    const keptOn = (date: ISODate) => committedMinutes(g, (d) => d === date && d >= from)
    const kept = rampDays.map((d) => keptOn(d.date))
    const total = remaining + kept.reduce((a, b) => a + b, 0)

    // first pass: follow the ramp, carrying amounts too small for a session forward
    let carry = 0
    rampDays.forEach((day, i) => {
      carry += (total * weights[i]!) / wSum - kept[i]!
      const last = i === n - 1
      let guard = 0
      while (remaining > 0 && guard++ < 20) {
        let want = Math.min(carry, remaining)
        if (want < g.minSession) {
          if (!(last && want >= STEP)) break
          want = g.minSession // round the final bit up to one session
        }
        const len = Math.min(ceil5(Math.min(want, g.maxSession)), Math.max(ceil5(remaining), g.minSession))
        const p = bestSpotUpTo(day, g, len, g.minSession)
        if (!p) break
        const placed = commit(day, g, p, 'goal')
        carry -= placed
        remaining -= placed
      }
    })

    // second pass: whatever didn't fit goes wherever there's still room, earliest first
    for (const day of studyDays) {
      let guard = 0
      while (remaining > 0 && guard++ < 20) {
        const len = Math.max(g.minSession, Math.min(ceil5(remaining), g.maxSession))
        const p = bestSpotUpTo(day, g, len, g.minSession)
        if (!p) break
        remaining -= commit(day, g, p, 'goal')
      }
    }

    if (remaining > 0) {
      const reviewStart = addDaysIso(g.deadline!, -(g.reviewDays ?? 0))
      const options: OverloadOption[] = [{ kind: 'addFreeTime', before: reviewStart }]
      const doable = Math.floor(((g.totalHours ?? 0) * 60 - remaining) / 30) / 2
      options.push({ kind: 'reduceHours', toHours: Math.max(0, doable) })
      const competitor = goals
        .filter((o) => o.id !== g.id) // whoever already took time before this goal's review
        .map((o) => ({
          o,
          minutes: out
            .filter((s) => s.goalId === o.id && s.date < reviewStart)
            .reduce((m, s) => m + duration(s), 0),
        }))
        .filter((x) => x.minutes > 0)
        .sort((a, b) => b.minutes - a.minutes)[0]
      if (competitor) options.push({ kind: 'pauseGoal', goalId: competitor.o.id, name: competitor.o.name })
      options.push({ kind: 'acceptShortfall' })
      warnings.push({
        kind: 'deadlineShortfall',
        goalId: g.id,
        shortfallMinutes: remaining,
        options,
        message: `“${g.name}”: ${formatDuration(remaining)} of ${formatDuration((g.totalHours ?? 0) * 60)} doesn’t fit before ${format(parseISO(reviewStart), 'EEE d MMM')}.`,
      })
    }
  }

  // ----- 5. recurring goals -----
  const recurring = goals
    .filter((g) => g.type === 'recurring' && g.perWeek && g.sessionLength)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
  const firstWeek = iso(startOfWeek(parseISO(from), { weekStartsOn: 1 }))

  for (const g of recurring) {
    const shortWeeks: { weekStart: ISODate; placed: number }[] = []
    const goalDays = new Set(
      state.sessions
        .filter((s) => s.goalId === g.id && s.kind === 'goal' && (s.status === 'done' || s.status === 'partial' || (isKept(s) && s.status !== 'skipped')))
        .map((s) => s.date),
    )
    for (let week = firstWeek; week <= to; week = addDaysIso(week, 7)) {
      const weekEnd = addDaysIso(week, 6)
      const inWeek = (d: ISODate) => d >= week && d <= weekEnd
      const already = state.sessions.filter(
        (s) =>
          s.goalId === g.id &&
          s.kind === 'goal' &&
          inWeek(s.date) &&
          (s.status === 'done' || s.status === 'partial' || (s.status === 'planned' && ((s.date >= today && s.date < from) || (s.date >= from && s.frozen)))),
      ).length
      const need = g.perWeek! - already
      if (need <= 0) continue
      const cut = weekEnd > to // horizon ends mid-week: place what fits, no warning

      // candidate days with their best spot
      const candidates: { day: Day; p: Placement; score: number }[] = []
      for (const day of days) {
        if (!inWeek(day.date) || goalDays.has(day.date)) continue
        const p = bestSpot(day, g, g.sessionLength!)
        if (p) candidates.push({ day, p, score: p.score - (2 * day.goalMin) / Math.max(day.capMin, 1) })
      }
      const adjacentToGoalDay = (date: ISODate) => goalDays.has(addDaysIso(date, -1)) || goalDays.has(addDaysIso(date, 1))
      const pool = g.noConsecutiveDays ? candidates.filter((c) => !adjacentToGoalDay(c.day.date)) : candidates

      // choose the best subset: most spread out, then best total score, then earliest
      let chosen: typeof pool = []
      for (let k = Math.min(need, pool.length); k >= 1 && chosen.length === 0; k--) {
        let bestKey: [number, number, string] | undefined
        for (const combo of combinations(pool, k)) {
          const idx = combo.map((c) => diffDays(c.day.date, week))
          const gaps = idx.slice(1).map((v, i) => v - idx[i]!)
          if (g.noConsecutiveDays && gaps.some((x) => x < 2)) continue
          const key: [number, number, string] = [
            gaps.length ? Math.min(...gaps) : 7,
            combo.reduce((s, c) => s + c.score, 0),
            combo.map((c) => c.day.date).join(),
          ]
          if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] + 1e-9 || (Math.abs(key[1] - bestKey[1]) <= 1e-9 && key[2] < bestKey[2])))) {
            bestKey = key
            chosen = combo
          }
        }
      }
      for (const c of chosen) {
        const p = bestSpot(c.day, g, g.sessionLength!) // re-check: earlier choices this week don't share days
        if (!p) continue
        commit(c.day, g, p, 'goal')
        goalDays.add(c.day.date)
      }
      const placed = chosen.length
      if (placed < need && !cut) shortWeeks.push({ weekStart: week, placed: placed + already })
    }
    if (shortWeeks.length) {
      const rest = g.noConsecutiveDays ? ' (with rest days between)' : ''
      const fewest = Math.min(...shortWeeks.map((w) => w.placed))
      warnings.push({
        kind: 'recurringShortfall',
        goalId: g.id,
        weeks: shortWeeks,
        message:
          shortWeeks.length === 1
            ? `“${g.name}”: only ${fewest} of ${g.perWeek} sessions fit in the week of ${format(parseISO(shortWeeks[0]!.weekStart), 'd MMM')}${rest}.`
            : `“${g.name}”: only ${fewest} of ${g.perWeek} sessions a week fit in ${shortWeeks.length} of the coming weeks${rest}.`,
      })
    }
  }

  // ----- 6. ongoing & book goals -----
  const ongoing = goals
    .filter((g) => g.type === 'ongoing' || (g.type === 'book' && (g.pagesDone ?? 0) < (g.totalPages ?? 0)))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))

  for (const g of ongoing) {
    const shortDates: ISODate[] = []
    const fill = (day: Day, target: number): number => {
      let left = target
      let guard = 0
      while (left >= STEP && guard++ < 20) {
        const chunk = Math.min(left, g.maxSession)
        if (chunk < g.minSession && chunk < target) break // leftover too small for a session
        const p = bestSpotUpTo(day, g, chunk, Math.min(g.minSession, chunk))
        if (!p) break
        left -= commit(day, g, p, 'goal')
      }
      return left
    }

    if (g.minutesPerDay) {
      for (const day of days) {
        if (g.type === 'ongoing' && g.endDate && day.date > g.endDate) break
        const done = committedMinutes(g, (d) => d === day.date)
        const left = fill(day, Math.max(0, g.minutesPerDay - done))
        if (left >= STEP) shortDates.push(day.date)
      }
    } else if (g.minutesPerWeek) {
      for (let week = firstWeek; week <= to; week = addDaysIso(week, 7)) {
        const weekEnd = addDaysIso(week, 6)
        const weekDays = days.filter((d) => d.date >= week && d.date <= weekEnd && (!g.endDate || d.date <= g.endDate))
        if (!weekDays.length) continue
        let need = g.minutesPerWeek - committedMinutes(g, (d) => d >= week && d <= weekEnd)
        const per = Math.min(g.maxSession, Math.max(g.minSession, ceil5(need / weekDays.length)))
        for (let pass = 0; pass < 3 && need >= STEP; pass++) {
          for (const day of weekDays) {
            if (need < STEP) break
            const chunk = Math.min(per, need)
            const p = bestSpotUpTo(day, g, Math.max(chunk, Math.min(g.minSession, need)), Math.min(g.minSession, need))
            if (p) need -= commit(day, g, p, 'goal')
          }
        }
        if (need >= STEP && weekEnd <= to) shortDates.push(week)
      }
    }

    if (shortDates.length) {
      const perWeek = !g.minutesPerDay
      warnings.push({
        kind: 'ongoingShortfall',
        goalId: g.id,
        dates: shortDates,
        message: perWeek
          ? `“${g.name}” gets less than ${formatDuration(g.minutesPerWeek!)} in ${shortDates.length} week${shortDates.length === 1 ? '' : 's'}.`
          : `“${g.name}” gets less than ${formatDuration(g.minutesPerDay!)} on ${shortDates.length} day${shortDates.length === 1 ? '' : 's'}.`,
      })
    }
  }

  // ----- 6b. extra free time "use it for" ongoing / book goals: beyond the usual target -----
  for (const day of days) {
    const b = boosts.get(day.date)
    if (!b) continue
    const gs = ongoing.filter((g) => b.goalIds.has(g.id) && !(g.type === 'ongoing' && g.endDate && day.date > g.endDate))
    let progress = gs.length > 0
    let guard = 0
    while (progress && guard++ < 50) {
      progress = false
      for (const g of gs) {
        // take turns, one session each, until the extra time (or the daily cap) is used up
        const p = bestSpotUpTo(day, g, g.maxSession, g.minSession, b.windows)
        if (p) {
          commit(day, g, p, 'goal')
          progress = true
        }
      }
    }
  }

  // ----- 7. topic labels (SPEC 3.6): planned study sessions say which topic(s) they cover -----
  for (const g of deadlineGoals) {
    const goalTopics = topicsOf(g.id)
    if (!goalTopics.length) continue
    const planned = out.filter((s) => s.goalId === g.id && s.kind === 'goal')
    const labels = assignTopics(
      goalTopics,
      planned,
      Math.round((g.totalHours ?? 0) * 60),
      workedByTopic(state.sessions.filter((s) => s.goalId === g.id)),
    )
    for (const s of planned) {
      const ids = labels.get(s.id)
      if (ids?.length) s.topicIds = ids
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id))
  return { from, to, sessions: out, warnings }
}

/** All k-element combinations of `items`, in order. */
function* combinations<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc]
    return
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]!)
    yield* combinations(items, k, i + 1, acc)
    acc.pop()
  }
}
