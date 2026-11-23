/**
 * Session actions (SPEC 4.1, 3.3) as pure transforms. The screen saves the result and
 * then re-plans, so skipped / unfinished minutes go back into the goal's pool.
 */
import type { ISODate, Session } from '../db/types'
import { toMinutes } from './time'

export const plannedMinutes = (s: Pick<Session, 'start' | 'end'>) => toMinutes(s.end) - toMinutes(s.start)

export const isWork = (s: Pick<Session, 'kind'>) => s.kind === 'goal' || s.kind === 'review'

/** Done / partly done can only be recorded once the day has come. */
export const canComplete = (s: Session, today: ISODate) => isWork(s) && s.date <= today

/** Skipping works for today and future days too ("I won't make Thursday's session"). */
export const canSkip = (s: Session) => isWork(s)

/** A planned session from an earlier day that was never marked. Counts as nothing (missed). */
export const isMissed = (s: Session, today: ISODate) => isWork(s) && s.status === 'planned' && s.date < today

export function complete(s: Session): Session {
  return { ...s, status: 'done', actualMinutes: plannedMinutes(s) }
}

/** "Did part of it": the real minutes. Reaching the planned length counts as done. */
export function partial(s: Session, minutes: number): Session {
  const m = Math.round(minutes)
  if (m >= plannedMinutes(s)) return { ...s, status: 'done', actualMinutes: m }
  return { ...s, status: 'partial', actualMinutes: m }
}

export function validatePartialMinutes(minutes: number): string | undefined {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Enter how many minutes you did.'
  if (minutes > 24 * 60) return 'That’s more than a day.'
  if (!Number.isInteger(minutes)) return 'Use whole minutes.'
  return undefined
}

export function skip(s: Session): Session {
  const { actualMinutes: _a, ...rest } = s
  return { ...rest, status: 'skipped' }
}

/** Back to planned (a mis-tap). Keeps the note. */
export function undo(s: Session): Session {
  const { actualMinutes: _a, ...rest } = s
  return { ...rest, status: 'planned' }
}

export function withNote(s: Session, note: string): Session {
  const t = note.trim()
  if (!t) {
    const { note: _n, ...rest } = s
    return rest
  }
  return { ...s, note: t.slice(0, 500) }
}

const order = (s: Session) => `${s.date} ${s.start}`

/** The most recent note of this goal from a session before `s` (SPEC: "next session shows the last note"). */
export function lastNoteBefore(s: Session, all: readonly Session[]): Session | undefined {
  if (!s.goalId) return undefined
  let best: Session | undefined
  for (const x of all) {
    if (x.goalId !== s.goalId || x.id === s.id || !x.note || order(x) >= order(s)) continue
    if (!best || order(x) > order(best)) best = x
  }
  return best
}

/** Every note of a goal, newest first (goal page). */
export function notesOf(goalId: string, all: readonly Session[]): Session[] {
  return all.filter((x) => x.goalId === goalId && x.note).sort((a, b) => order(b).localeCompare(order(a)))
}
