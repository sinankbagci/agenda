/** Pure time-of-day helpers. 'HH:mm' strings <-> minutes since midnight. */
import type { TimeOfDay, Weekday } from '../db/types'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export const isTime = (s: unknown): s is TimeOfDay => typeof s === 'string' && TIME_RE.test(s)

export function toMinutes(t: TimeOfDay): number {
  const m = TIME_RE.exec(t)
  if (!m) throw new Error(`Invalid time "${t}"`)
  return Number(m[1]) * 60 + Number(m[2])
}

export function fromMinutes(min: number): TimeOfDay {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Length of [start, end) in minutes; wraps past midnight when end <= start (e.g. sleep 23:30–07:30). */
export function spanMinutes(start: TimeOfDay, end: TimeOfDay): number {
  const d = toMinutes(end) - toMinutes(start)
  return d > 0 ? d : d + 1440
}

/** "1h 30m", "45m", "2h". */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Monday-first display order. */
export const WEEKDAYS_MON_FIRST: Weekday[] = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** "Mon–Fri", "Mon, Wed, Fri", "Every day", "Weekends". */
export function formatWeekdays(days: readonly Weekday[]): string {
  const set = new Set(days)
  const ordered = WEEKDAYS_MON_FIRST.filter((d) => set.has(d))
  if (ordered.length === 7) return 'Every day'
  if (ordered.length === 0) return 'No days'
  if (ordered.length === 2 && set.has(6) && set.has(0)) return 'Weekends'
  // contiguous run in Mon-first order?
  const idx = ordered.map((d) => WEEKDAYS_MON_FIRST.indexOf(d))
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1)
  if (contiguous && ordered.length >= 3) {
    return `${WEEKDAY_SHORT[ordered[0]!]}–${WEEKDAY_SHORT[ordered[ordered.length - 1]!]}`
  }
  return ordered.map((d) => WEEKDAY_SHORT[d]).join(', ')
}
