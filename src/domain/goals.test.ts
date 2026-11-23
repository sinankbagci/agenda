import { describe, expect, it } from 'vitest'
import {
  TEMPLATES,
  blankGoal,
  bookPagesPerDay,
  describeGoal,
  normalizeGoal,
  previewGoal,
  studyDays,
  validateGoal,
  weeklyMinutes,
  type GoalDraft,
} from './goals'
import type { GoalType } from '../db/types'

const TODAY = '2026-11-23' // Monday

const midterm = (over: Partial<GoalDraft> = {}): GoalDraft => ({
  ...blankGoal('deadline', TODAY),
  name: 'Algebra midterm',
  deadline: '2026-12-12',
  totalHours: 15,
  reviewDays: 1,
  ...over,
})

const errorsOf = (d: GoalDraft) => validateGoal(d, TODAY).errors
const warningsOf = (d: GoalDraft) => validateGoal(d, TODAY).warnings

describe('blank goals and templates', () => {
  it('every blank goal type is valid once named', () => {
    for (const type of ['deadline', 'recurring', 'ongoing', 'book'] as GoalType[]) {
      expect(validateGoal({ ...blankGoal(type, TODAY), name: 'X' }, TODAY), type).toEqual({ errors: [], warnings: [] })
    }
  })

  it('every template is valid once named, and has a unique key', () => {
    for (const t of TEMPLATES) {
      const d = t.make(TODAY)
      expect(validateGoal({ ...d, name: d.name || 'X' }, TODAY).errors, t.key).toEqual([])
    }
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length)
  })

  it('default dates are relative to today', () => {
    expect(blankGoal('deadline', TODAY).deadline).toBe('2026-12-14')
  })
})

describe('validateGoal', () => {
  it('accepts the acceptance-scenario midterm', () => {
    expect(validateGoal(midterm(), TODAY)).toEqual({ errors: [], warnings: [] })
  })

  it('requires a name', () => {
    expect(errorsOf(midterm({ name: '   ' }))).toContain('Give the goal a name.')
  })

  it('checks session lengths for non-recurring goals', () => {
    expect(errorsOf(midterm({ minSession: 90, maxSession: 30 }))).toContain('The longest session can’t be shorter than the shortest one.')
    expect(errorsOf(midterm({ minSession: NaN }))).toContain('Enter a shortest and longest session in minutes.')
    expect(warningsOf(midterm({ minSession: 5 }))).toContain('Sessions shorter than 10 minutes are hard to plan around.')
  })

  it('deadline goals: date, hours and review days', () => {
    expect(errorsOf(midterm({ deadline: '2026-11-20' }))).toContain('The deadline is in the past.')
    expect(errorsOf(midterm({ deadline: TODAY }))).toContain('The deadline is today — there’s no time left to plan.')
    expect(errorsOf(midterm({ deadline: undefined }))).toContain('Pick a deadline.')
    expect(errorsOf(midterm({ totalHours: 0 }))).toContain('Enter how many hours it needs.')
    expect(errorsOf(midterm({ reviewDays: 20 }))).toContain('Review days must be 0–14.')
    expect(warningsOf(midterm({ deadline: '2026-11-24', reviewDays: 1 }))).toContain('There are no study days left before the review day(s).')
    expect(warningsOf(midterm({ totalHours: 0.25, minSession: 30 }))).toContain('The total is shorter than one session.')
  })

  it('recurring goals: at most 4 sessions a week with rest days', () => {
    const workout = { ...blankGoal('recurring', TODAY), name: 'Workout', perWeek: 4, sessionLength: 45 }
    expect(errorsOf(workout)).toEqual([])
    expect(warningsOf(workout)[0]).toMatch(/^4 a week with rest days only fits every other week/)
    expect(warningsOf({ ...workout, perWeek: 3 })).toEqual([])
    expect(errorsOf({ ...workout, perWeek: 5 })).toContain('With rest days in between, at most 4 sessions fit in a week.')
    expect(errorsOf({ ...workout, perWeek: 5, noConsecutiveDays: false })).toEqual([])
    expect(errorsOf({ ...workout, perWeek: 8, noConsecutiveDays: false })).toContain('Sessions per week must be 1–7.')
    expect(errorsOf({ ...workout, sessionLength: 0 })).toContain('Session length must be 1–360 minutes.')
  })

  it('ongoing goals need a per-day or per-week target', () => {
    const read = { ...blankGoal('ongoing', TODAY), name: 'Read' }
    expect(errorsOf({ ...read, minutesPerDay: undefined })).toContain('Enter a target in minutes per day or per week.')
    expect(errorsOf({ ...read, minutesPerDay: undefined, minutesPerWeek: 150 })).toEqual([])
    expect(errorsOf({ ...read, endDate: '2026-01-01' })).toContain('The end date is in the past.')
  })

  it('book goals: pages, progress and target date', () => {
    const book = { ...blankGoal('book', TODAY), name: 'Dune', totalPages: 412 }
    expect(errorsOf(book)).toEqual([])
    expect(errorsOf({ ...book, pagesDone: 500 })).toContain('Pages read can’t be more than the total.')
    expect(errorsOf({ ...book, totalPages: 0 })).toContain('Enter the number of pages.')
    expect(errorsOf({ ...book, deadline: TODAY })).toContain('The target date must be after today.')
    expect(errorsOf({ ...book, deadline: undefined })).toEqual([]) // target date is optional
  })

  it('validates per-goal focus timer overrides only when set', () => {
    expect(errorsOf(midterm({ pomodoroWork: 50, pomodoroBreak: 10, pomodoroLongBreak: 20, cyclesBeforeLong: 3 }))).toEqual([])
    expect(errorsOf(midterm({ pomodoroWork: 50, pomodoroBreak: 10, pomodoroLongBreak: 20, cyclesBeforeLong: 0 }))).toContain(
      'Cycles before a long break must be 1–12.',
    )
  })
})

describe('normalizeGoal', () => {
  it('drops fields that belong to other goal types and empty optionals', () => {
    const d = normalizeGoal({ ...midterm(), perWeek: 3, minutesPerDay: 30, totalPages: 100, preferredTime: undefined, icon: '', name: '  Algebra  ' })
    expect(d).not.toHaveProperty('perWeek')
    expect(d).not.toHaveProperty('minutesPerDay')
    expect(d).not.toHaveProperty('totalPages')
    expect(d).not.toHaveProperty('preferredTime')
    expect(d).not.toHaveProperty('icon')
    expect(d).toMatchObject({ name: 'Algebra', deadline: '2026-12-12', totalHours: 15, reviewDays: 1 })
  })

  it('is idempotent and keeps an empty name for validation', () => {
    const once = normalizeGoal(midterm({ name: '' }))
    expect(once.name).toBe('')
    expect(normalizeGoal(once)).toEqual(once)
  })

  it('recurring: min and max session follow the session length', () => {
    const d = normalizeGoal({ ...blankGoal('recurring', TODAY), name: 'W', sessionLength: 60, minSession: 10, maxSession: 200 })
    expect(d).toMatchObject({ minSession: 60, maxSession: 60 })
  })

  it('ongoing keeps only one target', () => {
    const d = normalizeGoal({ ...blankGoal('ongoing', TODAY), name: 'L', minutesPerDay: 20, minutesPerWeek: 300 })
    expect(d.minutesPerDay).toBe(20)
    expect(d).not.toHaveProperty('minutesPerWeek')
  })

  it('removes a partially empty focus override completely only when all are empty', () => {
    expect(normalizeGoal({ ...midterm(), pomodoroWork: undefined })).not.toHaveProperty('pomodoroWork')
    expect(normalizeGoal({ ...midterm(), pomodoroWork: 50, pomodoroBreak: 10 })).toMatchObject({ pomodoroWork: 50, pomodoroBreak: 10 })
  })
})

describe('summaries', () => {
  it('study days exclude the review days (spec: Dec 12 midterm, Dec 11 review)', () => {
    expect(studyDays('2026-12-12', 1, TODAY)).toBe(18) // Nov 23 … Dec 10
    expect(studyDays('2026-11-24', 1, TODAY)).toBe(0)
  })

  it('previews what a goal means per day', () => {
    expect(previewGoal(midterm(), TODAY)).toBe('15h over 18 study days ≈ 50m a day on average, review on Fri 11 Dec.')
    expect(previewGoal(midterm({ reviewDays: 2 }), TODAY)).toBe('15h over 17 study days ≈ 53m a day on average, review from Thu 10 Dec.')
    expect(previewGoal({ ...blankGoal('recurring', TODAY), name: 'W', perWeek: 4, sessionLength: 45 }, TODAY)).toBe('About 3h a week.')
    expect(previewGoal(midterm({ name: '' }), TODAY)).toBeUndefined() // invalid → no preview
  })

  it('book pages per day', () => {
    expect(bookPagesPerDay({ totalPages: 412, pagesDone: 12, deadline: '2026-12-03' }, TODAY)).toBe(40) // 400 pages / 10 days
    expect(bookPagesPerDay({ totalPages: 412, pagesDone: 0 }, TODAY)).toBeUndefined()
    expect(previewGoal({ ...blankGoal('book', TODAY), name: 'Dune', totalPages: 412, pagesDone: 12, deadline: '2026-12-03' }, TODAY)).toBe(
      '400 pages left → 40 pages a day to finish by Thu 3 Dec.',
    )
  })

  it('weekly minutes per type', () => {
    expect(weeklyMinutes({ ...blankGoal('ongoing', TODAY), minutesPerDay: 30 })).toBe(210)
    expect(weeklyMinutes({ ...blankGoal('ongoing', TODAY), minutesPerDay: undefined, minutesPerWeek: 150 })).toBe(150)
    expect(weeklyMinutes(midterm())).toBeUndefined()
  })

  it('describes goals for cards', () => {
    expect(describeGoal(midterm(), TODAY)).toBe('15h by Sat 12 Dec · 1 review day · 19 days left')
    expect(describeGoal({ ...blankGoal('recurring', TODAY), perWeek: 4, sessionLength: 45 }, TODAY)).toBe('4× a week · 45m · rest days between')
    expect(describeGoal({ ...blankGoal('ongoing', TODAY), minutesPerDay: 30, endDate: '2027-01-31' }, TODAY)).toBe('30m a day until Sun 31 Jan')
    expect(describeGoal({ ...blankGoal('book', TODAY), totalPages: 412, pagesDone: 12, deadline: '2026-12-03' }, TODAY)).toBe(
      '12 / 412 pages · 30m a day · 40 pages/day to finish by Thu 3 Dec',
    )
  })
})
