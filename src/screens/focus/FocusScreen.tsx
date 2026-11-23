import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { db } from '../../db/db'
import type { FocusInterval } from '../../db/types'
import { repos } from '../../db/repositories'
import { endFocus, pauseFocus, resumeFocus, skipFocusBreak, startFocus, type EndResult } from '../../db/focusStore'
import { cycleDots, formatCountdown, isBreak, remainingMs, resolveConfig, trackedMinutes } from '../../domain/focusTimer'
import { withNote } from '../../domain/sessions'
import { formatDuration } from '../../domain/time'
import { enqueueReplan } from '../../app/usePlanKeeper'
import { Burst, unlockAudio } from '../../ui/feedback'
import { useSettings } from '../../ui/form'
import { useFocus } from './useFocus'
import { useWakeLock } from './useWakeLock'

const PHASE = { work: 'Focus', break: 'Short break', longBreak: 'Long break' } as const

/** Start Focus on a goal (optionally from a session) — used by the Focus tab and the session sheet. */
export async function beginFocus(goalId: string, sessionId?: string) {
  unlockAudio() // inside the tap: lets the phase bells play later on iOS
  await startFocus({ goalId, sessionId, now: Date.now() })
}

export function FocusScreen() {
  const navigate = useNavigate()
  const [ended, setEnded] = useState<EndResult | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const [ending, setEnding] = useState(false)

  const finish = async () => {
    if (ending) return
    setEnding(true)
    const r = await endFocus(Date.now())
    void enqueueReplan()
    setEnded(r ?? null)
    setEnding(false)
  }

  const { timer, now, sync } = useFocus(
    () => {
      setCelebrating(true)
      setTimeout(() => setCelebrating(false), 1600)
      void enqueueReplan()
    },
    () => void finish(),
  )
  const goals = useLiveQuery(() => repos.goals.all(), [], [])
  const topics = useLiveQuery(() => repos.topics.all(), [], [])
  const intervals = useLiveQuery(
    (): Promise<FocusInterval[]> => (timer ? db.focusIntervals.where('startedAt').aboveOrEqual(timer.runStartedAt).toArray() : Promise.resolve([])),
    [timer?.runStartedAt],
    [] as FocusInterval[],
  )
  useWakeLock(!!timer && !timer.pausedAt)

  if (ended) return <FocusSummary result={ended} goalName={goals.find((g) => g.id === ended.goalId)?.name ?? 'your goal'} onDone={() => navigate('/today')} />
  if (timer === undefined) return null
  if (!timer) return <FocusStart />

  const goal = goals.find((g) => g.id === timer.goalId)
  const topicName = topics.find((t) => t.id === timer.topicId)?.name
  const left = remainingMs(timer, now)
  const pct = timer.phaseLength ? 1 - left / (timer.phaseLength * 60_000) : 1
  const dots = cycleDots(timer)
  const tracked = trackedMinutes(timer, intervals, now)
  const planned = sync?.plannedMinutes ?? 0
  const paused = !!timer.pausedAt
  const r = 140
  const c = 2 * Math.PI * r

  return (
    <div className={`focus-full phase-${timer.phase}${paused ? ' paused' : ''}`} style={{ ['--goal' as string]: goal?.color ?? 'var(--accent)' }}>
      <div className="focus-top">
        <button type="button" className="btn focus-ghost" onClick={() => navigate(-1)} aria-label="Leave Focus running">
          ‹ Back
        </button>
        <span className="focus-goal">
          {goal?.icon && <span aria-hidden>{goal.icon} </span>}
          {goal?.name ?? 'Goal'}
          {topicName && <span className="focus-topic">{topicName}</span>}
        </span>
        <span className="focus-top-spacer" />
      </div>

      <div className="focus-center">
        <div className="focus-dial">
          <svg viewBox="0 0 320 320" aria-hidden>
            <circle cx="160" cy="160" r={r} className="dial-track" />
            <circle cx="160" cy="160" r={r} className="dial-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 160 160)" />
          </svg>
          <div className="dial-text">
            <span className="focus-phase">
              {PHASE[timer.phase]}
              {paused ? ' · paused' : ''}
            </span>
            <span className="focus-count" role="timer" aria-live="off">
              {formatCountdown(left)}
            </span>
            <span className="focus-dots" aria-label={`Cycle ${dots.done} of ${dots.total} done`}>
              {Array.from({ length: dots.total }, (_, i) => (i < dots.done ? '●' : '○')).join('')}
            </span>
          </div>
          {celebrating && <Burst color={goal?.color ?? 'var(--ok)'} />}
        </div>
        <p className="focus-today">
          {timer.targets.length > 0 ? (
            <>
              <strong>{formatDuration(Math.floor(tracked))}</strong> of {formatDuration(planned)} planned today
              {celebrating && <span className="focus-done"> ✓ Today’s {goal?.name} done</span>}
            </>
          ) : (
            <>
              <strong>{formatDuration(Math.floor(tracked))}</strong> focused (not planned today)
            </>
          )}
        </p>
      </div>

      <div className="focus-controls">
        {paused ? (
          <button type="button" className="btn big focus-main" onClick={() => void resumeFocus(Date.now())}>
            ▶ Resume
          </button>
        ) : (
          <button type="button" className="btn big focus-main" onClick={() => void pauseFocus(Date.now())}>
            ❚❚ Pause
          </button>
        )}
        {isBreak(timer) && (
          <button type="button" className="btn big" onClick={() => void skipFocusBreak(Date.now())}>
            Skip break
          </button>
        )}
        <button
          type="button"
          className="btn big"
          disabled={ending}
          onClick={() => {
            if (window.confirm('End this focus session? The time so far is saved.')) void finish()
          }}
        >
          End
        </button>
      </div>
    </div>
  )
}

/** No timer: start from one of today's sessions, or focus on any goal. */
function FocusStart() {
  const settings = useSettings()
  const today = format(new Date(), 'yyyy-MM-dd')
  const data = useLiveQuery(async () => {
    const [goals, sessions] = await Promise.all([repos.goals.all(), repos.sessions.byDate(today)])
    return { goals, sessions }
  }, [today])
  if (!data || !settings) return null
  const open = data.sessions.filter((s) => (s.kind === 'goal' || s.kind === 'review') && (s.status === 'planned' || s.status === 'partial') && s.goalId)
  const active = data.goals.filter((g) => g.active)
  const timerText = (goalId: string) => {
    const g = data.goals.find((x) => x.id === goalId)
    if (!g) return ''
    const c = resolveConfig(g, settings)
    return `${c.work}/${c.shortBreak}, long ${c.longBreak} after ${c.cyclesBeforeLong}`
  }

  return (
    <section className="screen">
      <h1>Focus</h1>
      <p className="muted intro">A full-screen timer. Work and breaks both count as time on the goal, and today’s sessions tick themselves off when you reach the planned time.</p>
      <h2>Today’s sessions</h2>
      {open.length === 0 ? (
        <p className="muted">Nothing left to focus on today.</p>
      ) : (
        <div className="list">
          {open.map((s) => {
            const g = data.goals.find((x) => x.id === s.goalId)!
            return (
              <button key={s.id} type="button" className="list-item" onClick={() => void beginFocus(s.goalId!, s.id)}>
                <span className="focus-swatch" style={{ background: g?.color }} aria-hidden />
                <span className="row-main">
                  <strong>
                    {g?.icon ? `${g.icon} ` : ''}
                    {s.kind === 'review' ? `Review: ${g?.name}` : g?.name}
                  </strong>
                  <span className="muted">
                    {s.start}–{s.end}
                    {s.status === 'partial' ? ` · did ${s.actualMinutes}m` : ''} · {timerText(s.goalId!)}
                  </span>
                </span>
                <span className="btn small primary" aria-hidden>
                  Focus
                </span>
              </button>
            )
          })}
        </div>
      )}
      <h2>Or focus on any goal</h2>
      {active.length === 0 ? (
        <p className="muted">
          No goals yet. <Link to="/goals/new">Add one</Link>.
        </p>
      ) : (
        <div className="list">
          {active.map((g) => (
            <button key={g.id} type="button" className="list-item" onClick={() => void beginFocus(g.id)}>
              <span className="focus-swatch" style={{ background: g.color }} aria-hidden />
              <span className="row-main">
                <strong>
                  {g.icon ? `${g.icon} ` : ''}
                  {g.name}
                </strong>
                <span className="muted">{timerText(g.id)}</span>
              </span>
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Change the default cycle in Settings → Focus timer; per goal on the goal’s page.</p>
    </section>
  )
}

/** After ending: what was tracked + the note prompt (SPEC: shows the session note prompt when focus ends). */
function FocusSummary({ result, goalName, onDone }: { result: EndResult; goalName: string; onDone: () => void }) {
  const [note, setNote] = useState('')
  const session = useLiveQuery(() => (result.noteSessionId ? repos.sessions.get(result.noteSessionId) : Promise.resolve(undefined)), [result.noteSessionId])
  const mins = Math.round(result.trackedMinutes)
  const save = async () => {
    if (session && note.trim()) await repos.sessions.put(withNote(session, note))
    onDone()
  }
  return (
    <section className="screen focus-summary">
      <h1>{mins >= 1 ? 'Nice focus! 🎉' : 'Focus ended'}</h1>
      <p className="intro">
        {mins >= 1 ? (
          <>
            You spent <strong>{formatDuration(mins)}</strong> on {goalName}
            {session && session.status === 'done' ? ' — today’s session is done.' : session?.status === 'partial' ? ` — logged as partly done (${session.actualMinutes}m).` : '.'}
          </>
        ) : (
          'Less than a minute was tracked, so nothing was logged.'
        )}
      </p>
      {session && (
        <label className="field note-field">
          <span className="field-label">Add a note for next time? (optional)</span>
          <textarea
            className="input textarea"
            rows={3}
            maxLength={500}
            value={note}
            placeholder="e.g. finished 4.2, stuck on quotient groups"
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        </label>
      )}
      <div className="button-row">
        <button type="button" className="btn primary" onClick={() => void save()}>
          {note.trim() ? 'Save note' : 'Done'}
        </button>
      </div>
    </section>
  )
}
