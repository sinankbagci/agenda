/**
 * Pure validation for the setup screens. Each validator returns a list of
 * human-readable problems; an empty list means "OK to save".
 * Warnings (allowed but suspicious) are separate from errors (blocked).
 */
import type { AvailabilityOverride, AvailabilityWindow, FixedBlock, MealRule, NewRow, Rule, Settings } from '../db/types'
import { formatDuration, isTime, spanMinutes, toMinutes } from './time'

export interface Check {
  errors: string[]
  warnings: string[]
}

const check = (): Check => ({ errors: [], warnings: [] })

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function requireRange(c: Check, start: string, end: string, what = 'End time') {
  if (!isTime(start) || !isTime(end)) {
    c.errors.push('Enter a start and end time.')
    return false
  }
  if (toMinutes(end) <= toMinutes(start)) {
    c.errors.push(`${what} must be after the start time.`)
    return false
  }
  return true
}

export function validateSleep(s: Pick<Settings, 'sleepStart' | 'sleepEnd'>): Check {
  const c = check()
  if (!isTime(s.sleepStart) || !isTime(s.sleepEnd)) {
    c.errors.push('Enter a bedtime and a wake-up time.')
    return c
  }
  if (s.sleepStart === s.sleepEnd) {
    c.errors.push('Bedtime and wake-up time can’t be the same.')
    return c
  }
  const len = spanMinutes(s.sleepStart, s.sleepEnd)
  if (len < 5 * 60) c.warnings.push(`That’s only ${formatDuration(len)} of sleep.`)
  if (len > 12 * 60) c.warnings.push(`That’s ${formatDuration(len)} of sleep — is that right?`)
  return c
}

export function validateFixedBlock(b: Omit<FixedBlock, 'id'>): Check {
  const c = check()
  if (!b.title.trim()) c.errors.push('Give it a title.')
  requireRange(c, b.start, b.end)
  if (b.rule.kind === 'weekly') {
    if (b.rule.weekdays.length === 0) c.errors.push('Pick at least one day.')
    if (b.rule.from && b.rule.until && b.rule.until < b.rule.from) c.errors.push('“Until” must be after “from”.')
  } else if (!ISO_DATE_RE.test(b.rule.date)) {
    c.errors.push('Pick a date.')
  }
  return c
}

export function validateMeal(m: Omit<MealRule, 'id'>): Check {
  const c = check()
  if (!m.name.trim()) c.errors.push('Give the meal a name.')
  if (!requireRange(c, m.windowStart, m.windowEnd, 'The window end')) return c
  if (!(m.duration > 0)) c.errors.push('Duration must be more than 0 minutes.')
  else if (m.duration > toMinutes(m.windowEnd) - toMinutes(m.windowStart)) {
    c.errors.push('The meal doesn’t fit inside its window.')
  }
  return c
}

export function validateWindow(w: Omit<AvailabilityWindow, 'id'>): Check {
  const c = check()
  if (requireRange(c, w.start, w.end) && toMinutes(w.end) - toMinutes(w.start) < 15) {
    c.warnings.push('Windows shorter than 15 minutes are hard to use.')
  }
  return c
}

/** Windows on the same weekday that overlap each other (pairs of ids). */
export function findOverlappingWindows(windows: readonly AvailabilityWindow[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i]!
      const b = windows[j]!
      if (a.weekday !== b.weekday) continue
      if (toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)) out.push([a.id, b.id])
    }
  }
  return out
}

export function validateOverride(o: Omit<AvailabilityOverride, 'id'>): Check {
  const c = check()
  if (!ISO_DATE_RE.test(o.date)) c.errors.push('Pick a date.')
  const hasStart = !!o.start
  const hasEnd = !!o.end
  if (hasStart !== hasEnd) c.errors.push('Enter both times, or neither for the whole day.')
  else if (hasStart) requireRange(c, o.start!, o.end!)
  if (o.kind === 'free' && !hasStart) c.errors.push('A “free” override needs a time range.')
  return c
}

export function validateRule(r: NewRow<Rule>): Check {
  const c = check()
  switch (r.kind) {
    case 'noGoalAfter':
    case 'noGoalBefore':
      if (!isTime(r.params.time)) c.errors.push('Enter a time.')
      break
    case 'keepFree':
      requireRange(c, r.params.start, r.params.end)
      break
  }
  return c
}

export function validateLimits(s: Pick<Settings, 'dailyCapWeekday' | 'dailyCapWeekend' | 'demandingCap' | 'bufferMin'>): Check {
  const c = check()
  for (const [v, label] of [
    [s.dailyCapWeekday, 'Weekday limit'],
    [s.dailyCapWeekend, 'Weekend limit'],
    [s.demandingCap, 'Demanding limit'],
  ] as const) {
    if (!(v >= 0 && v <= 24)) c.errors.push(`${label} must be between 0 and 24 hours.`)
  }
  if (!(s.bufferMin >= 0 && s.bufferMin <= 120)) c.errors.push('Buffer must be between 0 and 120 minutes.')
  if (s.demandingCap > Math.max(s.dailyCapWeekday, s.dailyCapWeekend)) {
    c.warnings.push('The demanding limit is higher than both daily limits, so it never applies.')
  }
  return c
}

/** Planned weekly free hours (sum of the availability template). Used for onboarding feedback. */
export function weeklyAvailableMinutes(windows: readonly AvailabilityWindow[]): number {
  return windows.reduce((sum, w) => sum + Math.max(0, toMinutes(w.end) - toMinutes(w.start)), 0)
}
