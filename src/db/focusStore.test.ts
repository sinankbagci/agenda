import { describe, expect, it } from 'vitest'
import { endFocus, getActiveTimer, pauseFocus, resumeFocus, skipFocusBreak, startFocus, syncFocus } from './focusStore'
import { createRepos } from './repositories'
import { freshDb, goalInput, sessionRow } from '../test/fixtures'

const MIN = 60_000
const T0 = new Date(2026, 10, 23, 16, 0).getTime() // Mon 23 Nov, 16:00 local

async function setup() {
  const db = freshDb()
  const r = createRepos(db)
  // SPEC example: Algebra 50 on / 10 off, 120 min planned today in two sessions
  const g = await r.goals.add(goalInput({ pomodoroWork: 50, pomodoroBreak: 10, pomodoroLongBreak: 20, cyclesBeforeLong: 2 }))
  await r.sessions.bulkPut([
    sessionRow({ id: 'a', goalId: g.id, date: '2026-11-23', start: '16:00', end: '17:00' }),
    sessionRow({ id: 'b', goalId: g.id, date: '2026-11-23', start: '19:55', end: '20:55' }),
  ])
  return { db, r, g }
}

describe('focus store', () => {
  it('the timer survives the app being closed (it lives in IndexedDB)', async () => {
    const { db, g } = await setup()
    await startFocus({ goalId: g.id, sessionId: 'a', now: T0 }, db)
    const reopened = await getActiveTimer(db)
    expect(reopened).toMatchObject({ goalId: g.id, phase: 'work', phaseLength: 50, cycle: 1, runStartedAt: T0 })
    expect(reopened!.targets).toEqual([{ id: 'a', prior: 0 }, { id: 'b', prior: 0 }])
    // a second start doesn't replace the running timer
    expect((await startFocus({ goalId: g.id, now: T0 + 5 * MIN }, db)).runStartedAt).toBe(T0)
  })

  it('records the topic of the session Focus started from', async () => {
    const { db, r, g } = await setup()
    await r.sessions.update('a', { topicIds: ['rings', 'groups'] })
    const t = await startFocus({ goalId: g.id, sessionId: 'a', now: T0 }, db)
    expect(t.topicId).toBe('rings')
    await endFocus(T0 + 30 * MIN, db)
    expect((await db.focusIntervals.toArray())[0]!.topicId).toBe('rings')
  })

  it('reaching the day’s planned amount auto-completes the sessions (work + breaks count)', async () => {
    const { db, r, g } = await setup()
    await startFocus({ goalId: g.id, sessionId: 'a', now: T0 }, db)
    const at60 = await syncFocus(T0 + 60 * MIN, db) // 50 work + 10 break
    expect(at60).toMatchObject({ transitions: 2, autoCompleted: [], trackedMinutes: 60, plannedMinutes: 120 })
    const at120 = await syncFocus(T0 + 120 * MIN, db) // 2 full cycles = 120 — app was locked meanwhile
    expect(at120.autoCompleted.sort()).toEqual(['a', 'b'])
    expect((await r.sessions.get('a'))!.status).toBe('done')
    expect((await r.sessions.get('b'))!.status).toBe('done')
    expect((await db.focusIntervals.orderBy('startedAt').toArray()).map((i) => `${i.phase}:${i.minutes}`)).toEqual(['work:50', 'break:10', 'work:50'])
  })

  it('extra time beyond the plan is kept on the last session when ending', async () => {
    const { db, r, g } = await setup()
    await startFocus({ goalId: g.id, sessionId: 'a', now: T0 }, db)
    // 50 work, 10 break, 50 work, then 20 min into... the long break (cycle 2 of 2) → 130 at its end
    const end = await endFocus(T0 + 125 * MIN, db)
    expect(Math.round(end!.trackedMinutes)).toBe(125)
    expect(await r.sessions.get('a')).toMatchObject({ status: 'done', actualMinutes: 60 })
    expect(await r.sessions.get('b')).toMatchObject({ status: 'done', actualMinutes: 65 })
    expect(end!.noteSessionId).toBe('b')
    expect(await getActiveTimer(db)).toBeUndefined()
  })

  it('ending early marks sessions partial with the real minutes', async () => {
    const { db, r, g } = await setup()
    await startFocus({ goalId: g.id, now: T0 }, db)
    await endFocus(T0 + 35 * MIN, db)
    expect(await r.sessions.get('a')).toMatchObject({ status: 'partial', actualMinutes: 35 })
    expect((await r.sessions.get('b'))!.status).toBe('planned')
  })

  it('pause stops the clock; skip break logs the break so far', async () => {
    const { db, g } = await setup()
    await startFocus({ goalId: g.id, now: T0 }, db)
    await pauseFocus(T0 + 10 * MIN, db)
    await resumeFocus(T0 + 70 * MIN, db) // an hour away, paused
    const s = await syncFocus(T0 + 75 * MIN, db)
    expect(Math.round(s.trackedMinutes)).toBe(15)
    await syncFocus(T0 + 103 * MIN, db) // 10 min done before the pause + 40 after resuming at 70 → work ends at 110
    expect((await getActiveTimer(db))!.phase).toBe('work')
    await syncFocus(T0 + 112 * MIN, db)
    expect((await getActiveTimer(db))!.phase).toBe('break')
    await skipFocusBreak(T0 + 114 * MIN, db)
    expect(await getActiveTimer(db)).toMatchObject({ phase: 'work', cycle: 2, phaseStartedAt: T0 + 114 * MIN })
    expect((await db.focusIntervals.orderBy('startedAt').toArray()).map((i) => `${i.phase}:${i.minutes}`)).toEqual(['work:50', 'break:4'])
  })

  it('a run ends by itself after the long break; nothing is counted twice', async () => {
    const { db, r, g } = await setup()
    await startFocus({ goalId: g.id, now: T0 }, db)
    const s = await syncFocus(T0 + 300 * MIN, db) // forgot about it for 5 hours
    expect(s.finished).toBe(true)
    expect(Math.round(s.trackedMinutes)).toBe(130) // 50+10+50+20, not 5 hours
    const end = await endFocus(T0 + 300 * MIN, db)
    expect(Math.round(end!.trackedMinutes)).toBe(130)
    expect(await r.sessions.get('b')).toMatchObject({ status: 'done', actualMinutes: 70 })
  })

  it('free focus on a goal with nothing planned today records a done session', async () => {
    const db = freshDb()
    const r = createRepos(db)
    const g = await r.goals.add(goalInput())
    await startFocus({ goalId: g.id, now: T0 }, db)
    const end = await endFocus(T0 + 40 * MIN, db)
    const s = await r.sessions.get(end!.noteSessionId!)
    expect(s).toMatchObject({ kind: 'goal', goalId: g.id, date: '2026-11-23', start: '16:00', end: '16:40', status: 'done', actualMinutes: 40, frozen: true })
    // and under a minute records nothing
    await startFocus({ goalId: g.id, now: T0 + 60 * MIN }, db)
    expect((await endFocus(T0 + 60 * MIN + 20_000, db))!.noteSessionId).toBeUndefined()
  })
})
