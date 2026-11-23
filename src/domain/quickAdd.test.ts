import { describe, expect, it } from 'vitest'
import { describeQuick, parseQuickAdd, quickToDraft, quickToTask } from './quickAdd'
import { validateGoal } from './goals'
import type { Location } from '../db/types'

const TODAY = '2026-11-23' // Monday
const places: Location[] = [{ id: 'gym', name: 'Gym' }, { id: 'campus', name: 'Campus' }, { id: 'lib', name: 'City Library' }]
const p = (s: string) => parseQuickAdd(s, TODAY, places)

describe('the SPEC examples', () => {
  it('"Algebra midterm Dec 12 15h" → deadline, date, 15 hours', () => {
    expect(p('Algebra midterm Dec 12 15h')).toMatchObject({ kind: 'deadline', name: 'Algebra midterm', date: '2026-12-12', minutes: 900, category: 'Study', missing: [] })
  })
  it('"Workout 4x week 45m gym" → recurring, 4/week, 45 min, location Gym', () => {
    expect(p('Workout 4x week 45m gym')).toMatchObject({ kind: 'recurring', name: 'Workout', perWeek: 4, minutes: 45, locationId: 'gym', category: 'Fitness', missing: [] })
  })
  it('"Read 30m daily" → ongoing, 30 min/day', () => {
    expect(p('Read 30m daily')).toMatchObject({ kind: 'ongoing', name: 'Read', minutes: 30, per: 'day', category: 'Reading', missing: [] })
  })
  it('"Book Dune 412 pages by Jan 31" → book', () => {
    expect(p('Book Dune 412 pages by Jan 31')).toMatchObject({ kind: 'book', name: 'Dune', pages: 412, date: '2027-01-31', missing: [] })
  })
})

describe('dates', () => {
  it.each([
    ['Exam 12 December 10h', '2026-12-12'],
    ['Exam December 12th 10h', '2026-12-12'],
    ['Exam on 3 jan 10h', '2027-01-03'], // already passed this year → next year
    ['Exam 2027-02-10 10h', '2027-02-10'],
    ['Exam due friday 10h', '2026-11-27'],
    ['Exam next mon 10h', '2026-11-30'], // on a Monday, "monday" is next week's
    ['Exam Nov 23 10h', '2026-11-23'], // today is still this year
  ])('%s', (text, date) => {
    expect(p(text).date).toBe(date)
  })
  it('impossible dates are ignored', () => {
    expect(p('Exam Feb 31 10h').date).toBeUndefined()
  })
})

describe('durations and frequencies', () => {
  it.each([
    ['Project Dec 20 1h30', 90],
    ['Project Dec 20 1h 30m', 90],
    ['Project Dec 20 1.5h', 90],
    ['Project Dec 20 1,5 hours', 90],
    ['Project Dec 20 90 min', 90],
    ['Project Dec 20 2 hours', 120],
  ])('%s', (text, minutes) => {
    expect(p(text).minutes).toBe(minutes)
  })
  it('“3 times a week”, “3x/week”, “3 per week”', () => {
    for (const s of ['Yoga 3 times a week 30m', 'Yoga 3x/week 30m', 'Yoga 3 per week 30m']) expect(p(s)).toMatchObject({ kind: 'recurring', perWeek: 3, minutes: 30, name: 'Yoga' })
  })
  it('weekly minutes → ongoing per week', () => {
    expect(p('Spanish 2h a week')).toMatchObject({ kind: 'ongoing', per: 'week', minutes: 120, name: 'Spanish', category: 'Learning' })
    expect(p('Guitar 20 minutes every day')).toMatchObject({ kind: 'ongoing', per: 'day', minutes: 20, name: 'Guitar' })
  })
})

describe('tasks, books, places, leftovers', () => {
  it('one-off tasks: homework / “task” / due today or tomorrow', () => {
    expect(p('Homework 2h tomorrow')).toMatchObject({ kind: 'task', name: 'Homework', minutes: 120, date: '2026-11-24', missing: [] })
    expect(p('task: call the bank 20m today')).toMatchObject({ kind: 'task', name: 'Call the bank', minutes: 20, date: TODAY })
    expect(p('Lab report 3h tomorrow')).toMatchObject({ kind: 'task', date: '2026-11-24' })
    expect(p('Assignment 2h')).toMatchObject({ kind: 'task', missing: ['do-it-by day'] })
  })
  it('a book without the word “book”', () => {
    expect(p('Project Hail Mary 476p')).toMatchObject({ kind: 'book', name: 'Project Hail Mary', pages: 476 })
  })
  it('multi-word places, “at”', () => {
    expect(p('Study 3x week 1h at City Library')).toMatchObject({ kind: 'recurring', locationId: 'lib', name: 'Study' })
    expect(p('Gym 3x week 1h')).toMatchObject({ kind: 'recurring', locationId: 'gym', name: 'Gym' }) // place is the name too
    expect(p('Gym 3x week 1h at gym')).toMatchObject({ kind: 'recurring', locationId: 'gym', name: 'Gym' }) // "at gym" is the place
  })
  it('missing bits are listed for the form', () => {
    expect(p('Thesis Dec 31').missing).toEqual(['hours'])
    expect(p('Workout 3x week').missing).toEqual(['session length'])
    expect(p('Book Dune').missing).toEqual(['pages'])
  })
  it('unknown → still keeps the name', () => {
    expect(p('Learn to juggle')).toMatchObject({ kind: 'unknown', name: 'Learn to juggle' })
    expect(p('   ')).toMatchObject({ kind: 'unknown', name: '' })
  })
})

describe('to forms', () => {
  it('drafts are valid goals once parsed fully', () => {
    for (const s of ['Algebra midterm Dec 12 15h', 'Workout 3x week 45m gym', 'Read 30m daily', 'Book Dune 412 pages by Jan 31', 'Spanish 2h a week']) {
      const d = quickToDraft(p(s), TODAY)
      expect(validateGoal(d, TODAY).errors, s).toEqual([])
    }
  })
  it('fills the right fields', () => {
    expect(quickToDraft(p('Algebra midterm Dec 12 15h'), TODAY)).toMatchObject({ type: 'deadline', name: 'Algebra midterm', deadline: '2026-12-12', totalHours: 15, category: 'Study' })
    expect(quickToDraft(p('Workout 4x week 45m gym'), TODAY)).toMatchObject({ type: 'recurring', perWeek: 4, sessionLength: 45, minSession: 45, maxSession: 45, locationId: 'gym', noConsecutiveDays: false })
    expect(quickToDraft(p('Spanish 2h a week'), TODAY)).toMatchObject({ type: 'ongoing', minutesPerWeek: 120, minutesPerDay: undefined })
    expect(quickToTask(p('Homework 2h tomorrow'), TODAY)).toEqual({ title: 'Homework', minutes: 120, doBy: '2026-11-24', category: 'Study', focus: 'demanding' })
  })
  it('describes what it understood', () => {
    expect(describeQuick(p('Workout 4x week 45m gym'), places)).toBe('Recurring · 4× a week · 45m · Gym')
    expect(describeQuick(p('Algebra midterm Dec 12 15h'), places)).toBe('Deadline · 15h · by Sat 12 Dec 2026')
    expect(describeQuick(p('Homework 2h tomorrow'), places)).toBe('One-off task · 2h · do it by Tue 24 Nov 2026')
    expect(describeQuick(p('Read 30m daily'), places)).toBe('Ongoing · 30m a day')
  })
})
