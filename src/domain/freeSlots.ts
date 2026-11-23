/**
 * Free-slot builder (SPEC 2.3, 2.4, build step 4). PURE: no Dexie, no Date.now().
 *
 *   free time = availability − sleep − fixed program − meals − travel − buffers
 *
 * For one calendar day it:
 *  1. takes the fixed program that occurs that day (never moved),
 *  2. places each meal at the earliest spot inside its window that avoids sleep, fixed
 *     blocks, other meals, and still leaves room for the travel the day needs,
 *  3. inserts travel blocks whenever two consecutive located items are at different
 *     places (the day starts and ends at home): travel to something happens as late as
 *     possible (arrive just in time); travel home at the end happens right after,
 *  4. subtracts all of that (and goal-independent hard rules) from the availability
 *     template + one-off overrides, then trims `bufferMin` where a free slot touches
 *     a fixed block, meal or travel block.
 *
 * Rules that only apply to one goal category (e.g. "no Study after 23:00") are NOT
 * applied here — that's the planner's job (step 6), since free slots are goal-agnostic.
 */
import { addDays, format, getDay, parseISO } from 'date-fns'
import type {
  AvailabilityOverride,
  AvailabilityWindow,
  Energy,
  FixedBlock,
  ISODate,
  Location,
  MealRule,
  Rule,
  Settings,
  TravelTime,
  Weekday,
} from '../db/types'
import { fromMinutes, toMinutes } from './time'
import { DAY_END, DAY_START, gaps, intersect, overlaps, subtract, union, type Range } from './ranges'

// ---------- Types ----------

export interface SlotInput {
  settings: Pick<Settings, 'sleepStart' | 'sleepEnd' | 'bufferMin' | 'homeLocationId'>
  fixedBlocks: readonly FixedBlock[]
  availabilityWindows: readonly AvailabilityWindow[]
  availabilityOverrides: readonly AvailabilityOverride[]
  mealRules: readonly MealRule[]
  locations: readonly Location[]
  travelTimes: readonly TravelTime[]
  rules: readonly Rule[]
}

/** All times are minutes since midnight, [start, end). */
export type DayBlock =
  | ({ kind: 'sleep' } & Range)
  | ({ kind: 'fixed'; blockId: string; title: string; locationId?: string } & Range)
  | ({ kind: 'meal'; mealId: string; name: string; locationId?: string } & Range)
  | ({ kind: 'travel'; fromId: string; toId: string } & Range)

export interface FreeSlot extends Range {
  energy: Energy
  /** Where you are during this slot (undefined if unknown, e.g. no home set). */
  locationId?: string
}

export type DayWarning =
  | { kind: 'fixedOverlap'; blockIds: [string, string]; message: string }
  | { kind: 'mealNotPlaced'; mealId: string; message: string }
  | { kind: 'travelUnknown'; fromId: string; toId: string; message: string }
  | { kind: 'travelTooTight'; fromId: string; toId: string; message: string }

export interface DayLayout {
  date: ISODate
  weekday: Weekday
  /** Everything that isn't free, sorted by start. */
  blocks: DayBlock[]
  /** Usable free time, sorted by start. */
  free: FreeSlot[]
  freeMinutes: number
  warnings: DayWarning[]
}

// ---------- Small pure helpers ----------

export function weekdayOf(date: ISODate): Weekday {
  return getDay(parseISO(date)) as Weekday
}

/** The day's [start, end) ranges covered by sleep; wraps past midnight. */
export function sleepRanges(sleepStart: string, sleepEnd: string): Range[] {
  const s = toMinutes(sleepStart)
  const e = toMinutes(sleepEnd)
  if (s === e) return []
  return s < e ? [{ start: s, end: e }] : union([{ start: s, end: DAY_END }, { start: DAY_START, end: e }])
}

/** When the waking day starts and ends (for "leave home" / "be home by"). */
function wakeAndBed(sleepStart: string, sleepEnd: string): { wake: number; bed: number } {
  const s = toMinutes(sleepStart)
  const e = toMinutes(sleepEnd)
  return { wake: e, bed: s > e ? s : DAY_END }
}

export function fixedOccursOn(block: FixedBlock, date: ISODate, weekday: Weekday): boolean {
  const r = block.rule
  if (r.kind === 'once') return r.date === date
  if (!r.weekdays.includes(weekday)) return false
  if (r.from && date < r.from) return false
  if (r.until && date > r.until) return false
  return true
}

/** Availability template for the weekday, de-overlapped (earlier window wins), then overrides applied. */
export function availabilityFor(input: SlotInput, date: ISODate, weekday: Weekday): (Range & { energy: Energy })[] {
  let avail: (Range & { energy: Energy })[] = []
  const windows = input.availabilityWindows
    .filter((w) => w.weekday === weekday)
    .map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end), energy: w.energy }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  for (const w of windows) avail.push(...subtract([w], avail))

  const overrides = input.availabilityOverrides.filter((o) => o.date === date)
  for (const o of overrides.filter((o) => o.kind === 'busy')) {
    avail = o.start && o.end ? subtract(avail, [{ start: toMinutes(o.start), end: toMinutes(o.end) }]) : []
  }
  for (const o of overrides.filter((o) => o.kind === 'free' && o.start && o.end)) {
    // extra free time (its own energy, default normal); existing windows keep their energy tag
    avail.push(...subtract([{ start: toMinutes(o.start!), end: toMinutes(o.end!), energy: o.energy ?? ('normal' as Energy) }], avail))
  }
  return avail.sort((a, b) => a.start - b.start)
}

/** Time ranges blocked for ALL goals by hard rules on this weekday. Category rules are left to the planner. */
export function ruleCuts(rules: readonly Rule[], weekday: Weekday): Range[] {
  const cuts: Range[] = []
  for (const r of rules) {
    if (r.kind === 'keepFree' && r.params.weekday === weekday) {
      cuts.push({ start: toMinutes(r.params.start), end: toMinutes(r.params.end) })
    } else if (r.kind === 'noGoalAfter' && !r.params.category) {
      cuts.push({ start: toMinutes(r.params.time), end: DAY_END })
    } else if (r.kind === 'noGoalBefore' && !r.params.category) {
      cuts.push({ start: DAY_START, end: toMinutes(r.params.time) })
    }
  }
  return union(cuts)
}

// ---------- Travel ----------

/** Lookup for travel minutes between places. Same place or unknown place → 0. */
export function makeTravel(travelTimes: readonly TravelTime[]) {
  const map = new Map(travelTimes.map((t) => [`${t.fromId}|${t.toId}`, t.minutes]))
  /** undefined = both places known but no time entered. */
  return (from: string | undefined, to: string | undefined): number | undefined => {
    if (!from || !to || from === to) return 0
    return map.get(`${from}|${to}`) ?? map.get(`${to}|${from}`)
  }
}

interface Anchor extends Range {
  locationId: string | undefined
  /** virtual start/end of day at home */
  virtual?: 'start' | 'end'
}

/** Located items + virtual "at home" before waking and after bedtime, sorted. */
function anchorsOf(located: readonly (Range & { locationId?: string })[], home: string | undefined, wake: number, bed: number): Anchor[] {
  const real = located
    .filter((x) => x.locationId)
    .map((x) => ({ start: x.start, end: x.end, locationId: x.locationId }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  return [
    { start: -1, end: Math.min(wake, real[0]?.start ?? wake), locationId: home, virtual: 'start' as const },
    ...real,
    { start: Math.max(bed, real.at(-1)?.end ?? bed), end: DAY_END + 1, locationId: home, virtual: 'end' as const },
  ]
}

/** Find a spot of `len` minutes inside `gap` avoiding `obstacles`; latest or earliest. */
function fitIn(gap: Range, obstacles: readonly Range[], len: number, prefer: 'late' | 'early'): Range | undefined {
  const spaces = gaps(intersect(obstacles as Range[], [gap]), gap.start, gap.end).filter((g) => g.end - g.start >= len)
  if (!spaces.length) return undefined
  if (prefer === 'late') {
    const g = spaces[spaces.length - 1]!
    return { start: g.end - len, end: g.end }
  }
  const g = spaces[0]!
  return { start: g.start, end: g.start + len }
}

/**
 * How many needed trips do NOT fit between their two located anchors, given the
 * unlocated obstacles (meals/fixed without a place)? Used when choosing where meals go.
 */
function travelFailures(anchors: readonly Anchor[], obstacles: readonly Range[], travel: ReturnType<typeof makeTravel>): number {
  let failures = 0
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    const t = travel(a.locationId, b.locationId) ?? 0
    if (t === 0) continue
    if (b.start < a.end || !fitIn({ start: a.end, end: b.start }, obstacles, t, 'late')) failures++
  }
  return failures
}

// ---------- The builder ----------

export function buildDay(input: SlotInput, date: ISODate): DayLayout {
  const weekday = weekdayOf(date)
  const { sleepStart, sleepEnd, bufferMin, homeLocationId: home } = input.settings
  const { wake, bed } = wakeAndBed(sleepStart, sleepEnd)
  const travel = makeTravel(input.travelTimes)
  const placeName = (id: string) => input.locations.find((l) => l.id === id)?.name ?? 'an unknown place'
  const warnings: DayWarning[] = []
  const warnedUnknown = new Set<string>()

  const sleep = sleepRanges(sleepStart, sleepEnd)

  // 1. Fixed program occurring today (locked).
  const fixed = input.fixedBlocks
    .filter((b) => fixedOccursOn(b, date, weekday))
    .map((b) => ({
      kind: 'fixed' as const,
      blockId: b.id,
      title: b.title,
      locationId: b.locationId,
      start: toMinutes(b.start),
      end: toMinutes(b.end),
    }))
    .sort((a, b) => a.start - b.start)
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      if (overlaps(fixed[i]!, fixed[j]!)) {
        warnings.push({
          kind: 'fixedOverlap',
          blockIds: [fixed[i]!.blockId, fixed[j]!.blockId],
          message: `“${fixed[i]!.title}” and “${fixed[j]!.title}” overlap.`,
        })
      }
    }
  }

  // 2. Meals: earliest feasible start inside the window.
  const meals: Extract<DayBlock, { kind: 'meal' }>[] = []
  const sortedMeals = [...input.mealRules].sort((a, b) => toMinutes(a.windowStart) - toMinutes(b.windowStart) || a.name.localeCompare(b.name))
  for (const m of sortedMeals) {
    const ws = toMinutes(m.windowStart)
    const we = toMinutes(m.windowEnd)
    const busy = union([...sleep, ...fixed, ...meals])
    // Trips that already can't fit (e.g. two fixed blocks too close) mustn't block the meal:
    // a spot is only rejected if it makes travel worse than it already is.
    const before = [...fixed, ...meals]
    const baseline = travelFailures(anchorsOf(before, home, wake, bed), before.filter((x) => !x.locationId), travel)
    let placed: Extract<DayBlock, { kind: 'meal' }> | undefined
    for (let s = ws; s + m.duration <= we; s++) {
      const cand = { kind: 'meal' as const, mealId: m.id, name: m.name, locationId: m.locationId, start: s, end: s + m.duration }
      if (busy.some((b) => overlaps(b, cand))) continue
      const all = [...fixed, ...meals, cand]
      const anchors = anchorsOf(all, home, wake, bed)
      const obstacles = all.filter((x) => !x.locationId)
      if (travelFailures(anchors, obstacles, travel) > baseline) continue
      placed = cand
      break
    }
    if (placed) meals.push(placed)
    else
      warnings.push({
        kind: 'mealNotPlaced',
        mealId: m.id,
        message: `No room for ${m.name} (${m.duration} min between ${m.windowStart}–${m.windowEnd}).`,
      })
  }
  meals.sort((a, b) => a.start - b.start)

  // 3. Travel between consecutive located items (day starts and ends at home).
  const items = [...fixed, ...meals]
  const anchors = anchorsOf(items, home, wake, bed)
  const obstacles: Range[] = items.filter((x) => !x.locationId)
  const travelBlocks: Extract<DayBlock, { kind: 'travel' }>[] = []
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (!a.locationId || !b.locationId || a.locationId === b.locationId) continue
    const t = travel(a.locationId, b.locationId)
    if (t === undefined) {
      const key = [a.locationId, b.locationId].sort().join('|')
      if (!warnedUnknown.has(key)) {
        warnedUnknown.add(key)
        warnings.push({
          kind: 'travelUnknown',
          fromId: a.locationId,
          toId: b.locationId,
          message: `No travel time set between ${placeName(a.locationId)} and ${placeName(b.locationId)}; assuming 0 min.`,
        })
      }
      continue
    }
    if (t === 0) continue
    const goingHome = b.virtual === 'end'
    const gap = { start: Math.max(a.end, DAY_START), end: Math.min(b.start, DAY_END) }
    let spot = gap.end > gap.start ? fitIn(gap, obstacles, t, goingHome ? 'early' : 'late') : undefined
    if (!spot) {
      // Doesn't fit: still show it (overlapping) so the problem is visible, and warn.
      spot = goingHome ? { start: a.end, end: Math.min(a.end + t, DAY_END) } : { start: Math.max(b.start - t, DAY_START), end: b.start }
      warnings.push({
        kind: 'travelTooTight',
        fromId: a.locationId,
        toId: b.locationId,
        message: `Not enough time to travel from ${placeName(a.locationId)} to ${placeName(b.locationId)} (${t} min) around ${fromMinutes(goingHome ? a.end : b.start)}.`,
      })
    }
    travelBlocks.push({ kind: 'travel', fromId: a.locationId, toId: b.locationId, ...spot })
  }

  // 4. Free time = availability − everything busy − goal-independent rules, minus buffers at busy edges.
  const busyBlocks = [...fixed, ...meals, ...travelBlocks]
  const avail = availabilityFor(input, date, weekday)
  const raw = subtract(avail, [...sleep, ...busyBlocks, ...ruleCuts(input.rules, weekday)])

  // location timeline: home before the first trip, then wherever each trip / located item puts you
  const events: { at: number; loc: string | undefined }[] = [
    { at: -1, loc: home },
    ...items.filter((x) => x.locationId).map((x) => ({ at: x.start, loc: x.locationId })),
    ...travelBlocks.map((t) => ({ at: t.end, loc: t.toId as string | undefined })),
  ].sort((a, b) => a.at - b.at)
  const locationAt = (min: number) => events.filter((e) => e.at <= min).at(-1)?.loc

  const free: FreeSlot[] = []
  for (const r of raw) {
    let { start, end } = r
    if (busyBlocks.some((b) => b.end === start)) start += bufferMin
    if (busyBlocks.some((b) => b.start === end)) end -= bufferMin
    if (end <= start) continue
    const slot: FreeSlot = { start, end, energy: r.energy }
    const loc = locationAt(start)
    if (loc) slot.locationId = loc
    free.push(slot)
  }

  const blocks: DayBlock[] = [
    ...sleep.map((s) => ({ kind: 'sleep' as const, ...s })),
    ...busyBlocks,
  ].sort((a, b) => a.start - b.start || a.end - b.end)

  return {
    date,
    weekday,
    blocks,
    free,
    freeMinutes: free.reduce((s, f) => s + (f.end - f.start), 0),
    warnings,
  }
}

/** `count` consecutive days starting at `from`. */
export function buildDays(input: SlotInput, from: ISODate, count: number): DayLayout[] {
  const start = parseISO(from)
  return Array.from({ length: count }, (_, i) => buildDay(input, format(addDays(start, i), 'yyyy-MM-dd')))
}
