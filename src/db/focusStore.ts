/**
 * Focus Mode persistence: the pure timer (domain/focusTimer.ts) + IndexedDB.
 * Every call takes `now`; the timer row survives the app being closed, and `syncFocus`
 * catches up whatever happened while it was away.
 */
import { format } from 'date-fns'
import { db as defaultDb, type AgendaDB } from './db'
import { createRepos } from './repositories'
import type { ActiveTimer, Session } from './types'
import {
  advance,
  allocate,
  endTimer,
  pause,
  pickTargets,
  plannedRemaining,
  resolveConfig,
  resume,
  skipBreak,
  startTimer,
  trackedMinutes,
  type IntervalDraft,
} from '../domain/focusTimer'

const day = (ms: number) => format(ms, 'yyyy-MM-dd')
const hhmm = (ms: number) => format(ms, 'HH:mm')
const withIds = (xs: IntervalDraft[]) => xs.map((x) => ({ ...x, id: crypto.randomUUID() }))
const tables = (db: AgendaDB) => [db.activeTimer, db.focusIntervals, db.sessions, db.goals, db.settings]

export async function getActiveTimer(db: AgendaDB = defaultDb): Promise<ActiveTimer | undefined> {
  return db.activeTimer.get('active')
}

/** Start focusing on a goal, optionally from one of today's sessions. Replaces nothing if one is running. */
export async function startFocus(args: { goalId: string; sessionId?: string; now: number }, db: AgendaDB = defaultDb): Promise<ActiveTimer> {
  return db.transaction('rw', tables(db), async () => {
    const running = await db.activeTimer.get('active')
    if (running) return running
    const r = createRepos(db)
    const goal = await r.goals.get(args.goalId)
    if (!goal) throw new Error('Goal not found')
    const config = resolveConfig(goal, await r.settings.get())
    const todays = await r.sessions.byDate(day(args.now))
    const timer = startTimer({ goalId: goal.id, config, now: args.now, sessionId: args.sessionId, targets: pickTargets(goal.id, todays, args.sessionId) })
    // the topic being worked on: the session's first topic (Focus intervals record it)
    const fromSession = todays.find((s) => s.id === args.sessionId) ?? todays.find((s) => s.id === timer.targets[0]?.id)
    if (fromSession?.topicIds?.[0]) timer.topicId = fromSession.topicIds[0]
    await db.activeTimer.put(timer)
    return timer
  })
}

export interface SyncResult {
  timer?: ActiveTimer
  /** Phase changes since the last sync (play the transition sound once if > 0). */
  transitions: number
  /** The run ended by itself (a long break finished) — call endFocus. */
  finished: boolean
  /** Sessions that just became done because the planned amount was reached. */
  autoCompleted: string[]
  trackedMinutes: number
  /** Minutes still planned for today's sessions of this goal when the run started. */
  plannedMinutes: number
}

/** Catch the timer up to `now`, store finished phases, auto-complete today's sessions when due. */
export async function syncFocus(now: number, db: AgendaDB = defaultDb): Promise<SyncResult> {
  return db.transaction('rw', tables(db), async () => {
    const t = await db.activeTimer.get('active')
    if (!t) return { transitions: 0, finished: false, autoCompleted: [], trackedMinutes: 0, plannedMinutes: 0 }
    const a = advance(t, now)
    if (a.intervals.length) await db.focusIntervals.bulkAdd(withIds(a.intervals))
    if (a.transitions) await db.activeTimer.put(a.timer)

    const intervals = await db.focusIntervals.where('startedAt').aboveOrEqual(t.runStartedAt).toArray()
    // when the run finished by itself its last phase is already stored: count nothing running
    const tracked = trackedMinutes(a.timer, intervals, a.finished ? a.timer.phaseStartedAt : now)
    const sessions = (await Promise.all(t.targets.map((x) => db.sessions.get(x.id)))).filter((s): s is Session => !!s)
    const planned = plannedRemaining(t.targets, sessions)

    // Auto-complete (SPEC 4.1b): only flip sessions to done here; minutes are settled at the end.
    const autoCompleted: string[] = []
    if (t.targets.length && tracked >= planned) {
      for (const s of allocate(t.targets, sessions, tracked)) {
        const before = sessions.find((x) => x.id === s.id)
        if (s.status === 'done' && before?.status !== 'done') {
          await db.sessions.put(s)
          autoCompleted.push(s.id)
        }
      }
    }
    return { timer: a.timer, transitions: a.transitions, finished: a.finished, autoCompleted, trackedMinutes: tracked, plannedMinutes: planned }
  })
}

export async function pauseFocus(now: number, db: AgendaDB = defaultDb) {
  await syncFocus(now, db)
  const t = await db.activeTimer.get('active')
  if (t) await db.activeTimer.put(pause(t, now))
}

export async function resumeFocus(now: number, db: AgendaDB = defaultDb) {
  const t = await db.activeTimer.get('active')
  if (t) await db.activeTimer.put(resume(t, now))
}

export async function skipFocusBreak(now: number, db: AgendaDB = defaultDb) {
  await syncFocus(now, db)
  await db.transaction('rw', [db.activeTimer, db.focusIntervals], async () => {
    const t = await db.activeTimer.get('active')
    if (!t) return
    const r = skipBreak(t, now)
    if (r.intervals.length) await db.focusIntervals.bulkAdd(withIds(r.intervals))
    await db.activeTimer.put(r.timer)
  })
}

export interface EndResult {
  goalId: string
  trackedMinutes: number
  /** The session the note prompt should write to (undefined if under a minute was tracked). */
  noteSessionId?: string
}

/**
 * End the run: log the current phase so far, settle the minutes on today's sessions (done /
 * partial / extra on the last one), or — if nothing was planned today — record a done session
 * for the time focused, so it counts toward the goal. Clears the timer.
 */
export async function endFocus(now: number, db: AgendaDB = defaultDb): Promise<EndResult | undefined> {
  const synced = await syncFocus(now, db)
  return db.transaction('rw', tables(db), async () => {
    const t = await db.activeTimer.get('active')
    if (!t) return undefined
    const stop = synced.finished ? t.phaseStartedAt : now
    const last = synced.finished ? [] : endTimer(t, stop)
    if (last.length) await db.focusIntervals.bulkAdd(withIds(last))
    const intervals = await db.focusIntervals.where('startedAt').aboveOrEqual(t.runStartedAt).toArray()
    const tracked = intervals.filter((i) => i.goalId === t.goalId).reduce((m, i) => m + (i.endedAt - i.startedAt), 0) / 60_000
    await db.activeTimer.delete('active')

    let noteSessionId: string | undefined
    const sessions = (await Promise.all(t.targets.map((x) => db.sessions.get(x.id)))).filter((s): s is Session => !!s)
    if (sessions.length) {
      const settled = allocate(t.targets, sessions, tracked)
      await db.sessions.bulkPut(settled)
      noteSessionId = [...settled].reverse().find((s) => (s.actualMinutes ?? 0) > 0)?.id ?? settled[0]?.id
    } else if (Math.round(tracked) >= 1) {
      const endMs = Math.min(now, new Date(day(t.runStartedAt) + 'T23:59:00').getTime())
      const s: Session = {
        id: `focus:${crypto.randomUUID()}`,
        kind: 'goal',
        goalId: t.goalId,
        date: day(t.runStartedAt),
        start: hhmm(t.runStartedAt),
        end: hhmm(Math.max(endMs, t.runStartedAt + 60_000)),
        status: 'done',
        actualMinutes: Math.round(tracked),
        frozen: true,
      }
      await db.sessions.put(s)
      noteSessionId = s.id
    }
    return { goalId: t.goalId, trackedMinutes: tracked, noteSessionId }
  })
}
