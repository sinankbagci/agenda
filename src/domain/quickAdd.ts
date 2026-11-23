/**
 * Quick add (SPEC 3.5): one line of text → a goal or task to confirm in a pre-filled form.
 * Rule-based (regex + keywords), PURE. Examples from the spec:
 *   "Algebra midterm Dec 12 15h"    → deadline, Dec 12, 15 h
 *   "Workout 4x week 45m gym"       → recurring, 4 / week, 45 min, at Gym
 *   "Read 30m daily"                → ongoing, 30 min / day
 *   "Book Dune 412 pages by Jan 31" → book, 412 pages, target Jan 31
 * plus one-off tasks: "Homework 2h tomorrow".
 */
import { addDays, addYears, format, isValid, parseISO } from 'date-fns'
import type { GoalCategory, ISODate, Location } from '../db/types'
import { blankGoal, type GoalDraft } from './goals'
import type { TaskDraft } from './oneOff'
import { formatDuration } from './time'

export type QuickKind = 'deadline' | 'recurring' | 'ongoing' | 'book' | 'task'

export interface QuickResult {
  kind: QuickKind | 'unknown'
  name: string
  date?: ISODate
  /** Total for deadline/task, session length for recurring, target for ongoing. */
  minutes?: number
  perWeek?: number
  per?: 'day' | 'week'
  pages?: number
  locationId?: string
  category?: GoalCategory
  /** What the form still needs. */
  missing: string[]
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)'

const TASK_WORDS = /\b(task|todo|to-do|homework|assignment|errand|exercise sheet|problem set)\b/i
const CATEGORY_WORDS: [RegExp, GoalCategory][] = [
  [/\b(exam|midterm|final|test|quiz|homework|assignment|study|lecture|thesis|essay|paper|lab)\b/i, 'Study'],
  [/\b(workout|gym|run|running|yoga|swim|swimming|cycling|bike|climb|climbing|training|lift|lifting|sport)\b/i, 'Fitness'],
  [/\b(read|reading|book|novel)\b/i, 'Reading'],
  [/\b(language|spanish|french|german|italian|japanese|chinese|korean|turkish|arabic|vocab|duolingo|guitar|piano|course|practice|coding)\b/i, 'Learning'],
]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/** A month/day without a year means the next time it comes (today included). */
function nextOccurrence(month: number, day: number, today: ISODate): ISODate | undefined {
  const t = parseISO(today)
  let d = new Date(t.getFullYear(), month, day)
  if (d.getMonth() !== month) return undefined // e.g. Feb 31
  if (iso(d) < today) d = addYears(d, 1)
  return iso(d)
}

function nextWeekday(target: number, today: ISODate): ISODate {
  const t = parseISO(today)
  let diff = (target - t.getDay() + 7) % 7
  if (diff === 0) diff = 7 // "friday" said on a Friday means next Friday
  return iso(addDays(t, diff))
}

const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase())
const dayIndex = (d: string) => DAYS.findIndex((x) => x.startsWith(d.slice(0, 3).toLowerCase()))

/** Take the first match of `re` out of `text`; returns the match and the remaining text. */
function take(text: string, re: RegExp): [RegExpExecArray | null, string] {
  const m = re.exec(text)
  if (!m) return [null, text]
  return [m, (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ')]
}

export function parseQuickAdd(input: string, today: ISODate, locations: readonly Location[] = []): QuickResult {
  let t = ` ${input.trim()} `
  const out: QuickResult = { kind: 'unknown', name: '', missing: [] }
  if (!input.trim()) return out

  // ---- dates (with an optional "by / due / on / until") ----
  const lead = '(?:\\b(?:by|due|on|until|before|deadline)\\s+)?'
  let m: RegExpExecArray | null
  ;[m, t] = take(t, new RegExp(`${lead}\\b(\\d{4}-\\d{2}-\\d{2})\\b`, 'i'))
  if (m) {
    const d = parseISO(m[1]!)
    if (isValid(d)) out.date = iso(d)
  }
  if (!out.date) {
    ;[m, t] = take(t, new RegExp(`${lead}\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'))
    if (m) out.date = nextOccurrence(monthIndex(m[1]!), Number(m[2]), today)
  }
  if (!out.date) {
    ;[m, t] = take(t, new RegExp(`${lead}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?`, 'i'))
    if (m) out.date = nextOccurrence(monthIndex(m[2]!), Number(m[1]), today)
  }
  if (!out.date) {
    ;[m, t] = take(t, new RegExp(`${lead}\\b(today|tonight|tomorrow|tmrw|tmr)\\b`, 'i'))
    if (m) out.date = /^to(day|night)$/i.test(m[1]!) ? today : iso(addDays(parseISO(today), 1))
  }
  if (!out.date) {
    ;[m, t] = take(t, new RegExp(`${lead}\\b(?:next\\s+)?${DAY_RE}\\b`, 'i'))
    if (m) out.date = nextWeekday(dayIndex(m[1]!), today)
  }

  // ---- pages ----
  ;[m, t] = take(t, /\b(\d{1,5})\s*(?:pages?|pp?)\b\.?/i)
  if (m) out.pages = Number(m[1])

  // ---- frequency: "4x week", "4 times a week", "4x/week", "4 per week" ----
  ;[m, t] = take(t, /\b(\d)\s*(?:x|×|times?)\s*(?:a|per|\/|each|every)?\s*(?:week|wk|w)\b/i)
  if (!m) [m, t] = take(t, /\b(\d)\s*(?:per|\/)\s*(?:week|wk)\b/i)
  if (m) out.perWeek = Number(m[1])

  // ---- duration: "1h30", "1h 30m", "1.5h", "90m", "2 hours" ----
  ;[m, t] = take(t, /\b(\d{1,3})\s*h(?:ours?|rs?)?\s*(\d{1,2})\s*(?:m(?:in(?:utes?|s)?)?)?\b/i)
  if (m) out.minutes = Number(m[1]) * 60 + Number(m[2])
  else {
    ;[m, t] = take(t, /\b(\d{1,3}(?:[.,]\d+)?)\s*h(?:ours?|rs?)?\b/i)
    if (m) out.minutes = Math.round(Number(m[1]!.replace(',', '.')) * 60)
    else {
      ;[m, t] = take(t, /\b(\d{1,4})\s*m(?:in(?:utes?|s)?)?\b/i)
      if (m) out.minutes = Number(m[1])
    }
  }

  // ---- per day / per week (ongoing) ----
  ;[m, t] = take(t, /\b(?:daily|every\s*day|each\s*day|a\s*day|per\s*day|\/\s*day)\b/i)
  if (m) out.per = 'day'
  else {
    ;[m, t] = take(t, /\b(?:weekly|every\s*week|a\s*week|per\s*week|\/\s*week)\b/i)
    if (m) out.per = 'week'
  }

  // ---- place: a saved location's name, optionally "at …" ----
  for (const l of [...locations].sort((a, b) => b.name.length - a.name.length)) {
    const name = l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // prefer an explicit "at <place>" ("Gym 3x week at gym": the first "Gym" is the name)
    ;[m, t] = take(t, new RegExp(`\\bat\\s+${name}\\b`, 'i'))
    if (!m) [m, t] = take(t, new RegExp(`\\b${name}\\b`, 'i'))
    if (m) {
      out.locationId = l.id
      // keep a place that is also the goal's name ("Gym") out of the name only if something else is left
      break
    }
  }

  // ---- kind ----
  const raw = input.trim()
  let rest = t.replace(/\b(by|due|on|at|for|every|per|a|an)\b\s*$/i, '').replace(/^\s*\b(a|an)\b/i, '')
  const bookLead = /^\s*book\b[:\s]*/i
  if (out.pages !== undefined || bookLead.test(rest)) {
    out.kind = 'book'
    rest = rest.replace(bookLead, '')
  } else if (out.perWeek !== undefined) out.kind = 'recurring'
  else if (out.per !== undefined) out.kind = 'ongoing'
  else if (TASK_WORDS.test(raw) || (out.date !== undefined && out.date <= iso(addDays(parseISO(today), 1)))) {
    out.kind = 'task'
    rest = rest.replace(/^\s*(?:task|todo|to-do)\b[:\s]*/i, '')
  } else if (out.date !== undefined || (out.minutes !== undefined && out.minutes >= 60 * 2)) out.kind = 'deadline'

  out.name = cleanName(rest)
  // a place word that was the whole name ("Gym 3x week 1h") → keep it as the name too
  if (!out.name && out.locationId) out.name = locations.find((l) => l.id === out.locationId)!.name
  out.category = CATEGORY_WORDS.find(([re]) => re.test(raw))?.[1]

  // ---- what the form still needs ----
  if (!out.name) out.missing.push('name')
  if (out.kind === 'deadline') {
    if (!out.date) out.missing.push('deadline')
    if (!out.minutes) out.missing.push('hours')
  }
  if (out.kind === 'task') {
    if (!out.minutes) out.missing.push('how long')
    if (!out.date) out.missing.push('do-it-by day')
  }
  if (out.kind === 'recurring' && !out.minutes) out.missing.push('session length')
  if (out.kind === 'ongoing' && !out.minutes) out.missing.push('minutes')
  if (out.kind === 'book' && !out.pages) out.missing.push('pages')
  return out
}

function cleanName(s: string): string {
  const n = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
    .replace(/\s+(by|due|on|at|for|until)$/i, '')
    .trim()
  return n ? n[0]!.toUpperCase() + n.slice(1) : ''
}

/** "Recurring · 4× a week · 45m · Gym" — what was understood, for the live preview. */
export function describeQuick(r: QuickResult, locations: readonly Location[] = []): string {
  if (r.kind === 'unknown') return 'Not sure what kind of goal this is — you can pick one next.'
  const day = (d?: ISODate) => (d ? format(parseISO(d), 'EEE d MMM yyyy') : '')
  const place = r.locationId ? locations.find((l) => l.id === r.locationId)?.name : undefined
  const parts: string[] = []
  switch (r.kind) {
    case 'deadline':
      parts.push('Deadline', r.minutes ? formatDuration(r.minutes) : '', r.date ? `by ${day(r.date)}` : '')
      break
    case 'task':
      parts.push('One-off task', r.minutes ? formatDuration(r.minutes) : '', r.date ? `do it by ${day(r.date)}` : '')
      break
    case 'recurring':
      parts.push('Recurring', `${r.perWeek}× a week`, r.minutes ? formatDuration(r.minutes) : '')
      break
    case 'ongoing':
      parts.push('Ongoing', r.minutes ? `${formatDuration(r.minutes)} a ${r.per}` : `every ${r.per}`)
      break
    case 'book':
      parts.push('Book', r.pages ? `${r.pages} pages` : '', r.date ? `finish by ${day(r.date)}` : '', r.minutes ? `${formatDuration(r.minutes)} a day` : '')
      break
  }
  if (place) parts.push(place)
  return parts.filter(Boolean).join(' · ')
}

/** The goal form's starting draft for a parsed line (not for tasks). */
export function quickToDraft(r: QuickResult, today: ISODate): GoalDraft {
  const kind = r.kind === 'unknown' || r.kind === 'task' ? 'deadline' : r.kind
  const d: GoalDraft = { ...blankGoal(kind, today), name: r.name }
  if (r.category) d.category = r.category
  if (r.locationId) d.locationId = r.locationId
  switch (kind) {
    case 'deadline':
      if (r.date) d.deadline = r.date
      if (r.minutes) d.totalHours = Math.round((r.minutes / 60) * 2) / 2 || 0.5
      break
    case 'recurring':
      d.perWeek = Math.min(7, Math.max(1, r.perWeek ?? 3))
      d.noConsecutiveDays = d.perWeek <= 3 // 4 a week with rest days only fits every other week
      if (r.minutes) {
        d.sessionLength = r.minutes
        d.minSession = r.minutes
        d.maxSession = r.minutes
      }
      break
    case 'ongoing':
      if (r.per === 'week') {
        d.minutesPerDay = undefined
        d.minutesPerWeek = r.minutes ?? 150
      } else d.minutesPerDay = r.minutes ?? 30
      break
    case 'book':
      if (r.pages) d.totalPages = r.pages
      d.deadline = r.date
      if (r.minutes) d.minutesPerDay = r.minutes
      break
  }
  return d
}

/** The task form's starting draft for a parsed task. */
export function quickToTask(r: QuickResult, today: ISODate): TaskDraft {
  return { title: r.name, minutes: r.minutes ?? 60, doBy: r.date ?? today, category: r.category ?? 'Study', focus: 'demanding' }
}

