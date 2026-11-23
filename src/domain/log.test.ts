import { describe, expect, it } from 'vitest'
import {
  finishBacklogItem,
  groupByDay,
  isHttpUrl,
  loggedMinutes,
  loggedSessions,
  normalizeLogEntry,
  pagesAfterLog,
  shouldPromptCheckIn,
  sortBacklog,
  stars,
  validateBacklogItem,
  validateCheckIn,
  validateLogEntry,
} from './log'
import { midterm, reading } from '../test/scenario'
import type { BacklogItem, LogEntry } from '../db/types'

const TODAY = '2026-11-23'
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({ id: crypto.randomUUID(), date: TODAY, type: 'exercise', title: 'Went for a run', ...over })

describe('log entries', () => {
  it('validates', () => {
    expect(validateLogEntry(entry({ minutes: 30 }), [], TODAY)).toEqual({ errors: [], warnings: [] })
    expect(validateLogEntry(entry({ title: ' ' }), [], TODAY).errors).toContain('Say what you did.')
    expect(validateLogEntry(entry({ date: '2026-11-24' }), [], TODAY).errors).toContain('You can only log things that already happened.')
    expect(validateLogEntry(entry({ minutes: 0 }), [], TODAY).errors).toHaveLength(1)
    expect(validateLogEntry(entry({ amount: 2.5 }), [], TODAY).errors).toHaveLength(1)
    expect(validateLogEntry(entry({ goalId: 'gone' }), [], TODAY).errors).toContain('That goal no longer exists.')
    expect(validateLogEntry(entry({ goalId: 'midterm' }), [midterm], TODAY).warnings[0]).toMatch(/Add the minutes/)
    const book = { ...reading, id: 'dune', type: 'book' as const }
    expect(validateLogEntry(entry({ goalId: 'dune', amount: 40 }), [book], TODAY).warnings).toEqual([])
  })

  it('normalizes', () => {
    expect(normalizeLogEntry({ date: TODAY, type: 'read', title: '  Dune ', minutes: NaN, note: '  ', goalId: '' })).toEqual({ date: TODAY, type: 'read', title: 'Dune' })
  })

  it('linked minutes and sessions per goal', () => {
    const logs = [entry({ goalId: 'g', minutes: 30 }), entry({ goalId: 'g', minutes: 20, date: '2026-11-20' }), entry({ goalId: 'g' }), entry({ goalId: 'x', minutes: 99 })]
    expect(loggedMinutes('g', logs)).toBe(50)
    expect(loggedMinutes('g', logs, (d) => d === TODAY)).toBe(30)
    expect(loggedSessions('g', logs)).toBe(2) // an entry without minutes isn't a session
    expect(loggedMinutes('g', undefined)).toBe(0)
  })

  it('pages after logging, capped at the book', () => {
    expect(pagesAfterLog({ pagesDone: 160, totalPages: 412 }, 40)).toBe(200)
    expect(pagesAfterLog({ pagesDone: 400, totalPages: 412 }, 40)).toBe(412)
  })

  it('groups by day, newest first, with check-ins', () => {
    const days = groupByDay([entry({ minutes: 30 }), entry({ minutes: 15 }), entry({ date: '2026-11-21' })], [{ date: '2026-11-22', energy: 3, mood: 4 }])
    expect(days.map((d) => `${d.date}:${d.entries.length}:${d.minutes}:${d.checkIn ? 'c' : '-'}`)).toEqual(['2026-11-23:2:45:-', '2026-11-22:0:0:c', '2026-11-21:1:0:-'])
  })
})

describe('evening check-in', () => {
  const day = [{ kind: 'goal' as const, end: '16:55' }, { kind: 'meal' as const, end: '19:45' }, { kind: 'goal' as const, end: '21:50' }, { kind: 'travel' as const, end: '22:10' }]
  it('prompts once the last planned item is over', () => {
    expect(shouldPromptCheckIn(day, 21 * 60, false, false)).toBe(false)
    expect(shouldPromptCheckIn(day, 21 * 60 + 50, false, false)).toBe(true) // travel doesn't count
    expect(shouldPromptCheckIn(day, 23 * 60, true, false)).toBe(false) // done already
    expect(shouldPromptCheckIn(day, 23 * 60, false, true)).toBe(false) // dismissed
  })
  it('with nothing planned: from 20:00', () => {
    expect(shouldPromptCheckIn([], 19 * 60, false, false)).toBe(false)
    expect(shouldPromptCheckIn([], 20 * 60, false, false)).toBe(true)
  })
  it('validates energy and mood', () => {
    expect(validateCheckIn({ energy: 4, mood: 3 })).toBeUndefined()
    expect(validateCheckIn({ energy: 4 })).toBeDefined()
    expect(validateCheckIn({ energy: 6 as 5, mood: 3 })).toBeDefined() // out-of-range value from bad data
  })
})

describe('backlog', () => {
  const item = (over: Partial<BacklogItem> = {}): BacklogItem => ({ id: crypto.randomUUID(), list: 'watch', title: 'Dune: Part Two', type: 'movie', status: 'todo', addedAt: 1, ...over })

  it('validates title and link', () => {
    expect(validateBacklogItem({ title: 'X', link: 'https://example.com/a' }).errors).toEqual([])
    expect(validateBacklogItem({ title: ' ' }).errors).toContain('Give it a title.')
    expect(validateBacklogItem({ title: 'X', link: 'javascript:alert(1)' }).errors).toHaveLength(1)
    expect(isHttpUrl('ftp://x')).toBe(false)
  })

  it('sorts: in progress, to do (newest first), finished (most recent first)', () => {
    const list = [item({ title: 'old todo', addedAt: 1 }), item({ title: 'fin', status: 'finished', finishedAt: 50 }), item({ title: 'new todo', addedAt: 9 }), item({ title: 'reading', status: 'inProgress', addedAt: 2 })]
    expect(sortBacklog(list).map((i) => i.title)).toEqual(['reading', 'new todo', 'old todo', 'fin'])
  })

  it('finishing asks for a rating + note and creates a log entry', () => {
    const r = finishBacklogItem(item(), 4, ' great sound ', 1000, TODAY)
    expect(r.item).toMatchObject({ status: 'finished', rating: 4, finishedAt: 1000, note: 'great sound' })
    expect(r.logEntry).toEqual({ date: TODAY, type: 'watched', title: 'Dune: Part Two', note: '★★★★☆ — great sound' })
    expect(finishBacklogItem(item({ list: 'read', type: 'book' }), 5, '', 1000, TODAY).logEntry).toEqual({ date: TODAY, type: 'read', title: 'Dune: Part Two', note: '★★★★★' })
    expect(stars(2)).toBe('★★☆☆☆')
  })
})
