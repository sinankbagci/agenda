/**
 * Goal rules (SPEC 2.1): templates, defaults, validation, normalisation and the
 * plain-language summaries shown on cards and in the form. PURE.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { FocusLevel, Goal, GoalCategory, GoalType, ISODate, Priority, TimeBucket } from '../db/types'
import type { Check } from './setupValidation'
import { formatDuration } from './time'

/** Everything the form edits (all type-specific fields may be present while editing). */
export type GoalDraft = Omit<Goal, 'id' | 'createdAt'>

export const GOAL_TYPES: { value: GoalType; label: string; hint: string }[] = [
  { value: 'deadline', label: 'Deadline', hint: 'A set amount of work by a date — an exam, a project.' },
  { value: 'recurring', label: 'Recurring', hint: 'A number of sessions every week — workouts, practice.' },
  { value: 'ongoing', label: 'Ongoing', hint: 'A steady amount of time per day or week — reading, a language.' },
  { value: 'book', label: 'Book', hint: 'A book with a page count, and optionally a date to finish it by.' },
]

export const CATEGORIES: GoalCategory[] = ['Study', 'Fitness', 'Reading', 'Learning', 'Other']

export const COLORS = ['#2f5d50', '#3a6ea5', '#7b4fa3', '#c0504d', '#d9822b', '#c9a227', '#4f8a3c', '#5f6b73'] as const

export const ICONS = ['📚', '🧮', '🧪', '💻', '💪', '🏃', '🧘', '📖', '🗣️', '🎸', '✍️', '🎯'] as const

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Low', 2: 'Medium', 3: 'High' }
export const FOCUS_LABEL: Record<FocusLevel, string> = { demanding: 'Demanding', light: 'Light' }
export const TIME_LABEL: Record<TimeBucket, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }

const COMMON: Omit<GoalDraft, 'type' | 'name' | 'category' | 'color'> = {
  priority: 2,
  focus: 'demanding',
  minSession: 30,
  maxSession: 90,
  active: true,
}

/** A blank goal of a type, with sensible defaults. `today` decides default dates. */
export function blankGoal(type: GoalType, today: ISODate): GoalDraft {
  const inWeeks = (w: number) => format(addDays(parseISO(today), w * 7), 'yyyy-MM-dd')
  switch (type) {
    case 'deadline':
      return { ...COMMON, type, name: '', category: 'Study', color: COLORS[0], deadline: inWeeks(3), totalHours: 10, reviewDays: 1 }
    case 'recurring':
      return { ...COMMON, type, name: '', category: 'Fitness', color: COLORS[3], focus: 'light', minSession: 45, maxSession: 45, perWeek: 3, sessionLength: 45, noConsecutiveDays: true }
    case 'ongoing':
      return { ...COMMON, type, name: '', category: 'Learning', color: COLORS[1], focus: 'light', minSession: 15, maxSession: 45, minutesPerDay: 30 }
    case 'book':
      return { ...COMMON, type, name: '', category: 'Reading', color: COLORS[2], focus: 'light', minSession: 15, maxSession: 60, totalPages: 300, pagesDone: 0, minutesPerDay: 30, deadline: inWeeks(6) }
  }
}

export interface GoalTemplate {
  key: string
  label: string
  icon: string
  description: string
  make: (today: ISODate) => GoalDraft
}

/** Starting points for "New goal". Everything stays editable. */
export const TEMPLATES: GoalTemplate[] = [
  {
    key: 'exam',
    label: 'Exam',
    icon: '📚',
    description: 'Study hours before an exam, with a review day',
    make: (t) => ({ ...blankGoal('deadline', t), name: '', icon: '📚', totalHours: 15, reviewDays: 1, minSession: 45, maxSession: 90 }),
  },
  {
    key: 'project',
    label: 'Project',
    icon: '💻',
    description: 'A piece of work due on a date',
    make: (t) => ({ ...blankGoal('deadline', t), icon: '💻', category: 'Other', color: COLORS[5], totalHours: 20, reviewDays: 0, minSession: 60, maxSession: 120 }),
  },
  {
    key: 'workout',
    label: 'Workout',
    icon: '💪',
    description: 'A few sessions a week with rest days',
    make: (t) => ({ ...blankGoal('recurring', t), name: 'Workout', icon: '💪', perWeek: 4, sessionLength: 45, minSession: 45, maxSession: 45 }),
  },
  {
    key: 'reading',
    label: 'Daily reading',
    icon: '📖',
    description: 'A little reading every day',
    make: (t) => ({ ...blankGoal('ongoing', t), name: 'Reading', icon: '📖', category: 'Reading', color: COLORS[2], minutesPerDay: 30, minSession: 15, maxSession: 30 }),
  },
  {
    key: 'language',
    label: 'Language',
    icon: '🗣️',
    description: 'Steady practice every week',
    make: (t) => ({ ...blankGoal('ongoing', t), name: '', icon: '🗣️', minutesPerDay: undefined, minutesPerWeek: 150, minSession: 20, maxSession: 45 }),
  },
  {
    key: 'book',
    label: 'Book',
    icon: '📕',
    description: 'Finish a book by a date',
    make: (t) => ({ ...blankGoal('book', t), icon: '📕' }),
  },
  { key: 'deadline', label: 'Custom deadline', icon: '🎯', description: 'Hours of work by a date', make: (t) => blankGoal('deadline', t) },
  { key: 'recurring', label: 'Custom recurring', icon: '🔁', description: 'Sessions every week', make: (t) => blankGoal('recurring', t) },
  { key: 'ongoing', label: 'Custom ongoing', icon: '♾️', description: 'Time per day or week', make: (t) => blankGoal('ongoing', t) },
]

/** Turn a stored goal back into an editable draft. */
export function toDraft(goal: Goal): GoalDraft {
  const { id: _id, createdAt: _c, ...rest } = goal
  return rest
}

const TYPE_FIELDS: Record<GoalType, (keyof GoalDraft)[]> = {
  deadline: ['deadline', 'totalHours', 'reviewDays'],
  recurring: ['perWeek', 'sessionLength', 'noConsecutiveDays'],
  ongoing: ['minutesPerDay', 'minutesPerWeek', 'endDate'],
  book: ['totalPages', 'pagesDone', 'minutesPerDay', 'deadline'],
}
const ALL_TYPE_FIELDS = [...new Set(Object.values(TYPE_FIELDS).flat())]
const POMODORO_FIELDS = ['pomodoroWork', 'pomodoroBreak', 'pomodoroLongBreak', 'cyclesBeforeLong'] as const

/**
 * Shape a draft for saving: drop fields of other goal types and empty optionals,
 * trim the name, and keep min/max session consistent with the type.
 */
export function normalizeGoal(d: GoalDraft): GoalDraft {
  const out: GoalDraft = { ...d, name: (d.name ?? '').trim() }
  for (const f of ALL_TYPE_FIELDS) if (!TYPE_FIELDS[d.type].includes(f)) delete out[f]
  // optional fields: remove undefined / NaN / empty so stored rows stay clean
  for (const [k, v] of Object.entries(out)) {
    if (k === 'name') continue // required: '' must survive so validation can report it
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) delete out[k as keyof GoalDraft]
  }
  if (out.type === 'recurring' && out.sessionLength) {
    out.minSession = out.sessionLength
    out.maxSession = out.sessionLength
  }
  if (out.type === 'ongoing') {
    // exactly one of per day / per week
    if (out.minutesPerDay) delete out.minutesPerWeek
  }
  if (out.type === 'book') {
    out.pagesDone = out.pagesDone ?? 0
  }
  if (!POMODORO_FIELDS.some((f) => out[f] !== undefined)) for (const f of POMODORO_FIELDS) delete out[f]
  return out
}

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

/** Calendar days from today until date (0 = today, negative = past). */
export const daysUntil = (date: ISODate, today: ISODate) => differenceInCalendarDays(parseISO(date), parseISO(today))

/**
 * Days available for deadline work, today included, before the review day(s).
 * Example: deadline Dec 12, 1 review day → study through Dec 10, review Dec 11.
 */
export function studyDays(deadline: ISODate, reviewDays: number, today: ISODate): number {
  return Math.max(0, daysUntil(deadline, today) - reviewDays)
}

export function validateGoal(input: GoalDraft, today: ISODate): Check {
  const d = normalizeGoal(input)
  const errors: string[] = []
  const warnings: string[] = []

  if (!d.name) errors.push('Give the goal a name.')

  if (d.type !== 'recurring') {
    if (!isPosInt(d.minSession) || !isPosInt(d.maxSession)) errors.push('Enter a shortest and longest session in minutes.')
    else if (d.maxSession < d.minSession) errors.push('The longest session can’t be shorter than the shortest one.')
    else if (d.maxSession > 360) errors.push('Sessions longer than 6 hours aren’t supported.')
    else if (d.minSession < 10) warnings.push('Sessions shorter than 10 minutes are hard to plan around.')
  }

  switch (d.type) {
    case 'deadline': {
      if (!d.deadline) {
        errors.push('Pick a deadline.')
        break
      }
      if (!(typeof d.totalHours === 'number' && d.totalHours > 0)) errors.push('Enter how many hours it needs.')
      if (!(Number.isInteger(d.reviewDays) && d.reviewDays! >= 0 && d.reviewDays! <= 14)) errors.push('Review days must be 0–14.')
      const left = daysUntil(d.deadline, today)
      if (left < 0) errors.push('The deadline is in the past.')
      else if (left === 0) errors.push('The deadline is today — there’s no time left to plan.')
      else if (errors.length === 0 && studyDays(d.deadline, d.reviewDays!, today) === 0) {
        warnings.push('There are no study days left before the review day(s).')
      }
      if (errors.length === 0 && d.totalHours! * 60 < d.minSession) {
        warnings.push('The total is shorter than one session.')
      }
      break
    }
    case 'recurring':
      if (!(isPosInt(d.perWeek) && d.perWeek <= 7)) errors.push('Sessions per week must be 1–7.')
      else if (d.noConsecutiveDays && d.perWeek > 4) errors.push('With rest days in between, at most 4 sessions fit in a week.')
      else if (d.noConsecutiveDays && d.perWeek === 4)
        warnings.push('4 a week with rest days only fits every other week (Sunday → Monday counts as back-to-back), so some weeks get 3.')
      if (!(isPosInt(d.sessionLength) && d.sessionLength <= 360)) errors.push('Session length must be 1–360 minutes.')
      break
    case 'ongoing': {
      const perDay = d.minutesPerDay
      const perWeek = d.minutesPerWeek
      if (!(isPosInt(perDay) || isPosInt(perWeek))) errors.push('Enter a target in minutes per day or per week.')
      else if ((perDay ?? 0) > 720 || (perWeek ?? 0) > 5040) errors.push('That target is more than 12 hours a day.')
      if (d.endDate && daysUntil(d.endDate, today) < 0) errors.push('The end date is in the past.')
      break
    }
    case 'book':
      if (!isPosInt(d.totalPages)) errors.push('Enter the number of pages.')
      if (!(Number.isInteger(d.pagesDone) && d.pagesDone! >= 0)) errors.push('Pages read must be 0 or more.')
      else if (isPosInt(d.totalPages) && d.pagesDone! > d.totalPages) errors.push('Pages read can’t be more than the total.')
      if (!isPosInt(d.minutesPerDay)) errors.push('Enter how many minutes a day you want to read.')
      if (d.deadline && daysUntil(d.deadline, today) < 1) errors.push('The target date must be after today.')
      break
  }

  if (d.pomodoroWork !== undefined) {
    if (!(isPosInt(d.pomodoroWork) && d.pomodoroWork <= 180)) errors.push('Focus length must be 1–180 minutes.')
    if (!(Number.isInteger(d.pomodoroBreak) && d.pomodoroBreak! >= 0 && d.pomodoroBreak! <= 60)) errors.push('Break must be 0–60 minutes.')
    if (!(Number.isInteger(d.pomodoroLongBreak) && d.pomodoroLongBreak! >= 0 && d.pomodoroLongBreak! <= 120))
      errors.push('Long break must be 0–120 minutes.')
    if (!(isPosInt(d.cyclesBeforeLong) && d.cyclesBeforeLong <= 12)) errors.push('Cycles before a long break must be 1–12.')
  }

  return { errors, warnings }
}

/** Pages per day needed to finish on the target date (today included), or undefined. */
export function bookPagesPerDay(g: Pick<GoalDraft, 'totalPages' | 'pagesDone' | 'deadline'>, today: ISODate): number | undefined {
  if (!g.totalPages || !g.deadline) return undefined
  const days = daysUntil(g.deadline, today)
  if (days < 1) return undefined
  return Math.ceil(Math.max(0, g.totalPages - (g.pagesDone ?? 0)) / days)
}

/** Planned minutes per week the goal asks for (for the "load" preview); undefined for deadlines. */
export function weeklyMinutes(g: GoalDraft): number | undefined {
  switch (g.type) {
    case 'recurring':
      return (g.perWeek ?? 0) * (g.sessionLength ?? 0)
    case 'ongoing':
      return g.minutesPerDay ? g.minutesPerDay * 7 : g.minutesPerWeek
    case 'book':
      return (g.minutesPerDay ?? 0) * 7
    case 'deadline':
      return undefined
  }
}

const day = (iso: ISODate) => format(parseISO(iso), 'EEE d MMM')

/** One-line description for goal cards, e.g. "15h by Sat 12 Dec · 1 review day". */
export function describeGoal(g: GoalDraft, today: ISODate): string {
  switch (g.type) {
    case 'deadline': {
      const parts = [`${formatDuration((g.totalHours ?? 0) * 60)} by ${g.deadline ? day(g.deadline) : '?'}`]
      if (g.reviewDays) parts.push(`${g.reviewDays} review day${g.reviewDays === 1 ? '' : 's'}`)
      if (g.deadline) {
        const left = daysUntil(g.deadline, today)
        parts.push(left < 0 ? 'past' : left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`)
      }
      return parts.join(' · ')
    }
    case 'recurring':
      return `${g.perWeek}× a week · ${formatDuration(g.sessionLength ?? 0)}${g.noConsecutiveDays ? ' · rest days between' : ''}`
    case 'ongoing': {
      const target = g.minutesPerDay ? `${formatDuration(g.minutesPerDay)} a day` : `${formatDuration(g.minutesPerWeek ?? 0)} a week`
      return g.endDate ? `${target} until ${day(g.endDate)}` : target
    }
    case 'book': {
      const parts = [`${g.pagesDone ?? 0} / ${g.totalPages} pages`, `${formatDuration(g.minutesPerDay ?? 0)} a day`]
      const ppd = bookPagesPerDay(g, today)
      if (ppd !== undefined && g.deadline) parts.push(`${ppd} pages/day to finish by ${day(g.deadline)}`)
      return parts.join(' · ')
    }
  }
}

/**
 * The "what does this mean" line under the form, e.g.
 * "15h over 17 study days ≈ 53 min a day, review on Fri 11 Dec".
 */
export function previewGoal(input: GoalDraft, today: ISODate): string | undefined {
  const g = normalizeGoal(input)
  if (validateGoal(g, today).errors.length) return undefined
  switch (g.type) {
    case 'deadline': {
      const days = studyDays(g.deadline!, g.reviewDays!, today)
      if (!days) return undefined
      const perDay = Math.round((g.totalHours! * 60) / days)
      let s = `${formatDuration(g.totalHours! * 60)} over ${days} study day${days === 1 ? '' : 's'} ≈ ${formatDuration(perDay)} a day on average`
      if (g.reviewDays) {
        const first = addDays(parseISO(g.deadline!), -g.reviewDays)
        s += `, review ${g.reviewDays === 1 ? 'on' : 'from'} ${format(first, 'EEE d MMM')}`
      }
      return `${s}.`
    }
    case 'book': {
      const ppd = bookPagesPerDay(g, today)
      return ppd !== undefined
        ? `${g.totalPages! - g.pagesDone!} pages left → ${ppd} pages a day to finish by ${day(g.deadline!)}.`
        : `${g.totalPages! - g.pagesDone!} pages left, ${formatDuration(g.minutesPerDay!)} of reading a day.`
    }
    default: {
      const w = weeklyMinutes(g)
      return w ? `About ${formatDuration(w)} a week.` : undefined
    }
  }
}
