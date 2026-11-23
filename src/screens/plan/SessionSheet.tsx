import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { Goal, Session } from '../../db/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import { canComplete, canSkip, lastNoteBefore, plannedMinutes, validatePartialMinutes } from '../../domain/sessions'
import { formatDuration } from '../../domain/time'
import { DateInput, NumberInput, TimeInput } from '../../ui/form'
import { isTime } from '../../domain/time'
import { taskDoBy } from '../../domain/oneOff'
import { logPages, validatePages } from '../../domain/progress'

/** 'part' = actions with the "did part of it" box already open (swipe-left → Part). */
export type SheetMode = 'actions' | 'part' | 'note'

const STATUS = { planned: 'Planned', done: 'Done', partial: 'Partly done', skipped: 'Skipped' } as const

/**
 * Bottom sheet for one session: complete / part / skip / undo, the note, and the
 * goal's last note at the top. In 'note' mode it's the "add a note?" prompt after completing.
 */
export function SessionSheet({
  session,
  goal,
  allSessions,
  today,
  mode,
  onClose,
  onComplete,
  onPartial,
  onSkip,
  onUndo,
  onNote,
  onRemove,
  onFocus,
  onFinishTask,
  onChangeTime,
}: {
  session: Session
  goal: Goal | undefined
  allSessions: readonly Session[]
  today: string
  mode: SheetMode
  onClose: () => void
  onComplete: () => void
  onPartial: (minutes: number) => void
  onSkip: () => void
  onUndo: () => void
  onNote: (note: string) => void
  /** Only for sessions the user placed (pinned). */
  onRemove: () => void
  /** Start Focus Mode on this session (today, not finished). */
  onFocus: () => void
  /** One-off tasks: the task is finished (completes the goal, drops the rest). */
  onFinishTask: () => void
  /** Pinned sessions: move to another day / time. */
  onChangeTime: (date: string, start: string, end: string) => void
}) {
  const [note, setNote] = useState(session.note ?? '')
  const [partOpen, setPartOpen] = useState(mode === 'part')
  const [minutes, setMinutes] = useState(session.actualMinutes ?? Math.round(plannedMinutes(session) / 2 / 5) * 5)
  const [partError, setPartError] = useState<string>()
  const [page, setPage] = useState<number>(NaN)
  const [moving, setMoving] = useState(false)
  const [when, setWhen] = useState({ date: session.date, start: session.start, end: session.end })
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const actionsMode = mode !== 'note'
  const last = lastNoteBefore(session, allSessions)
  const name = goal?.name ?? 'Deleted goal'
  const title = session.kind === 'review' ? `Review: ${name}` : name

  useEffect(() => {
    if (mode === 'note') noteRef.current?.focus()
  }, [mode])

  const saveNoteAndClose = () => {
    if ((session.note ?? '') !== note.trim()) onNote(note)
    if (goal?.type === 'book' && Number.isFinite(page) && !validatePages(page, goal.totalPages)) {
      void repos.goals.update(goal.id, logPages(goal, page, today))
    }
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={saveNoteAndClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ ['--goal' as string]: goal?.color }}>
        <div className="sheet-grip" aria-hidden />
        {mode === 'note' ? (
          <h2 className="sheet-title">Nice work! 🎉</h2>
        ) : (
          <h2 className="sheet-title">
            {goal?.icon && <span aria-hidden>{goal.icon} </span>}
            {title}
          </h2>
        )}
        <p className="muted sheet-sub">
          {format(parseISO(session.date), 'EEE d MMM')} · {session.start}–{session.end} · {formatDuration(plannedMinutes(session))} ·{' '}
          <strong className={`st-text st-${session.status}`}>
            {STATUS[session.status]}
            {session.actualMinutes !== undefined && session.status !== 'planned' ? ` (${formatDuration(session.actualMinutes)})` : ''}
          </strong>
        </p>

        {actionsMode && <SessionTopics session={session} />}

        {session.pinned && actionsMode && (
          <div className="pinned-info">
            <span>📌 Added by you at this time — the planner won’t move it.</span>
            {session.status === 'planned' && (
              <span className="button-row">
                <button type="button" className="btn small" onClick={() => setMoving(!moving)} aria-expanded={moving}>
                  Change time
                </button>
                <button
                  type="button"
                  className="btn small link"
                  onClick={() => {
                    if (window.confirm('Remove this session from your plan?')) onRemove()
                  }}
                >
                  Remove from plan
                </button>
              </span>
            )}
            {moving && (
              <div className="move-box">
                <DateInput value={when.date} onChange={(date) => setWhen({ ...when, date })} />
                <TimeInput value={when.start} onChange={(start) => setWhen({ ...when, start })} />
                <span>–</span>
                <TimeInput value={when.end} onChange={(end) => setWhen({ ...when, end })} />
                <button
                  type="button"
                  className="btn small primary"
                  disabled={!isTime(when.start) || !isTime(when.end) || when.end <= when.start || when.date < today}
                  onClick={() => onChangeTime(when.date, when.start, when.end)}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        )}

        {goal?.oneOff && actionsMode && (
          <p className="muted small task-info">
            📋 One-off task — do it by {taskDoBy(goal)}. {goal.completedAt ? '✓ Finished.' : 'When it’s finished, tap “Finished the task”: the rest of its time is freed.'}
          </p>
        )}

        {last && actionsMode && (
          <div className="last-note">
            <span className="muted">Last time ({format(parseISO(last.date), 'EEE d MMM')}):</span> {last.note}
          </div>
        )}

        {actionsMode && (
          <div className="sheet-actions">
            {session.date === today && (session.status === 'planned' || session.status === 'partial') && (
              <button type="button" className="btn primary big" onClick={onFocus}>
                ◷ Focus
              </button>
            )}
            {goal?.oneOff && !goal.completedAt && canComplete(session, today) && session.status !== 'skipped' ? (
              <button type="button" className="btn big primary" onClick={onFinishTask}>
                ✓ Finished the task
              </button>
            ) : (
              session.status !== 'done' &&
              canComplete(session, today) && (
                <button type="button" className="btn big" onClick={onComplete}>
                  ✓ Done
                </button>
              )
            )}
            {canComplete(session, today) && session.status !== 'skipped' && (
              <button type="button" className="btn big" onClick={() => setPartOpen(!partOpen)} aria-expanded={partOpen}>
                Did part of it
              </button>
            )}
            {session.status === 'planned' && canSkip(session) && (
              <button type="button" className="btn big" onClick={onSkip}>
                Skip
              </button>
            )}
            {session.status !== 'planned' && (
              <button type="button" className="btn big" onClick={onUndo}>
                Undo ({STATUS[session.status].toLowerCase()})
              </button>
            )}
          </div>
        )}
        {actionsMode && !canComplete(session, today) && session.status === 'planned' && (
          <p className="muted small">You can mark it done on the day. Skipping now gives its time back to the plan.</p>
        )}

        {partOpen && actionsMode && (
          <div className="part-box">
            <label className="field">
              <span className="field-label">How long did you work on it?</span>
              <NumberInput value={minutes} min={1} suffix="min" onChange={setMinutes} />
            </label>
            {partError && <p className="error">{partError}</p>}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const err = validatePartialMinutes(minutes)
                setPartError(err)
                if (!err) onPartial(minutes)
              }}
            >
              Save
            </button>
          </div>
        )}

        {(mode === 'note' || session.status === 'done' || session.status === 'partial' || session.note) && (
          <label className="field note-field">
            <span className="field-label">{mode === 'note' ? 'Add a note for next time? (optional)' : 'Note'}</span>
            <textarea
              ref={noteRef}
              className="input textarea"
              rows={3}
              maxLength={500}
              value={note}
              placeholder="e.g. finished 4.2, stuck on quotient groups"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}

        {mode === 'note' && goal?.type === 'book' && (
          <label className="field">
            <span className="field-label">Which page are you on? (optional)</span>
            <NumberInput value={page} min={0} max={goal.totalPages} onChange={setPage} />
            {Number.isFinite(page) && validatePages(page, goal.totalPages) && <span className="error small">{validatePages(page, goal.totalPages)}</span>}
          </label>
        )}

        <div className="button-row sheet-footer">
          {mode === 'note' ? (
            <>
              <button type="button" className="btn primary" onClick={saveNoteAndClose}>
                {Number.isFinite(page) ? 'Save' : note.trim() ? 'Save note' : 'Done'}
              </button>
              {(note.trim() || Number.isFinite(page)) && (
                <button type="button" className="btn" onClick={onClose}>
                  Not now
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={saveNoteAndClose}>
                Close
              </button>
              {goal && (
                <Link to={`/goals/${goal.id}`} className="btn link">
                  Open goal
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The session's topics with a one-tap "done" toggle (marking a topic done schedules its reviews). */
function SessionTopics({ session }: { session: Session }) {
  const topics = useLiveQuery(() => (session.goalId ? repos.topics.byGoal(session.goalId) : Promise.resolve([])), [session.goalId], [])
  const mine = topics.filter((t) => session.topicIds?.includes(t.id))
  if (!mine.length) return null
  return (
    <div className="session-topics">
      <span className="muted small">{session.kind === 'review' && !session.spacedReview ? 'Covers (weak first):' : 'Topic:'}</span>
      {mine.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.done ? 'chip-toggle on' : 'chip-toggle'}
          aria-pressed={t.done}
          onClick={() => void repos.topics.update(t.id, t.done ? { done: false, doneAt: undefined } : { done: true, doneAt: Date.now() })}
        >
          {t.done ? `✓ ${t.name} done` : `Mark ${t.name} done`}
        </button>
      ))}
    </div>
  )
}
