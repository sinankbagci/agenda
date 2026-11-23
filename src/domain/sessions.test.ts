import { describe, expect, it } from 'vitest'
import { canComplete, canSkip, complete, isMissed, lastNoteBefore, notesOf, partial, skip, undo, validatePartialMinutes, withNote } from './sessions'
import type { Session } from '../db/types'

const s = (over: Partial<Session> = {}): Session => ({
  id: 'a', kind: 'goal', goalId: 'g', date: '2026-11-23', start: '16:00', end: '16:55', status: 'planned', frozen: false, ...over,
})
const TODAY = '2026-11-23'

describe('session actions', () => {
  it('complete records the planned minutes', () => {
    expect(complete(s())).toMatchObject({ status: 'done', actualMinutes: 55 })
  })

  it('partial records real minutes; reaching the plan counts as done', () => {
    expect(partial(s(), 30)).toMatchObject({ status: 'partial', actualMinutes: 30 })
    expect(partial(s(), 55)).toMatchObject({ status: 'done', actualMinutes: 55 })
    expect(partial(s(), 70)).toMatchObject({ status: 'done', actualMinutes: 70 }) // extra time counts too
  })

  it('validates partial minutes', () => {
    expect(validatePartialMinutes(30)).toBeUndefined()
    expect(validatePartialMinutes(0)).toBe('Enter how many minutes you did.')
    expect(validatePartialMinutes(NaN)).toBe('Enter how many minutes you did.')
    expect(validatePartialMinutes(12.5)).toBe('Use whole minutes.')
  })

  it('skip and undo clear the recorded minutes; undo keeps the note', () => {
    const done = { ...complete(s()), note: 'ok' }
    expect(skip(done)).toEqual({ ...s(), status: 'skipped', note: 'ok' })
    expect(undo(done)).toEqual({ ...s(), note: 'ok' })
  })

  it('notes are trimmed, capped, and removed when empty', () => {
    expect(withNote(s(), '  finished 4.2  ').note).toBe('finished 4.2')
    expect(withNote(s({ note: 'x' }), '   ')).not.toHaveProperty('note')
    expect(withNote(s(), 'x'.repeat(600)).note).toHaveLength(500)
  })

  it('what can be done when', () => {
    expect(canComplete(s(), TODAY)).toBe(true)
    expect(canComplete(s({ date: '2026-11-24' }), TODAY)).toBe(false) // future: skip only
    expect(canSkip(s({ date: '2026-11-24' }))).toBe(true)
    expect(canComplete(s({ kind: 'meal' }), TODAY)).toBe(false)
    expect(isMissed(s({ date: '2026-11-22' }), TODAY)).toBe(true)
    expect(isMissed(s({ date: '2026-11-22', status: 'done' }), TODAY)).toBe(false)
    expect(isMissed(s(), TODAY)).toBe(false)
  })
})

describe('notes', () => {
  const all = [
    s({ id: '1', date: '2026-11-20', note: 'groups done' }),
    s({ id: '2', date: '2026-11-21', note: 'stuck on quotient groups' }),
    s({ id: '3', date: '2026-11-21', start: '20:00', end: '20:30', goalId: 'other', note: 'other goal' }),
    s({ id: '4', date: '2026-11-23' }),
    s({ id: '5', date: '2026-11-24', note: 'later note' }),
  ]
  it('the next session shows the most recent earlier note of the same goal', () => {
    expect(lastNoteBefore(all[3]!, all)?.note).toBe('stuck on quotient groups')
    expect(lastNoteBefore(all[0]!, all)).toBeUndefined()
    expect(lastNoteBefore(s({ id: 'm', kind: 'meal', goalId: undefined }), all)).toBeUndefined()
  })
  it('lists a goal’s notes newest first', () => {
    expect(notesOf('g', all).map((x) => x.id)).toEqual(['5', '2', '1'])
  })
})
