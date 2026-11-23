import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { Goal, Session } from '../../db/types'
import { canComplete, canSkip, lastNoteBefore, plannedMinutes, validatePartialMinutes } from '../../domain/sessions'
import { formatDuration } from '../../domain/time'
import { NumberInput } from '../../ui/form'

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
}) {
  const [note, setNote] = useState(session.note ?? '')
  const [partOpen, setPartOpen] = useState(mode === 'part')
  const [minutes, setMinutes] = useState(session.actualMinutes ?? Math.round(plannedMinutes(session) / 2 / 5) * 5)
  const [partError, setPartError] = useState<string>()
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

        {session.pinned && actionsMode && (
          <p className="pinned-info">
            📌 Added by you at this time — the planner won’t move it.{' '}
            {session.status === 'planned' && (
              <button
                type="button"
                className="btn small link"
                onClick={() => {
                  if (window.confirm('Remove this session from your plan?')) onRemove()
                }}
              >
                Remove from plan
              </button>
            )}
          </p>
        )}

        {last && actionsMode && (
          <div className="last-note">
            <span className="muted">Last time ({format(parseISO(last.date), 'EEE d MMM')}):</span> {last.note}
          </div>
        )}

        {actionsMode && (
          <div className="sheet-actions">
            {session.status !== 'done' && canComplete(session, today) && (
              <button type="button" className="btn primary big" onClick={onComplete}>
                ✓ Done
              </button>
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

        <div className="button-row sheet-footer">
          {mode === 'note' ? (
            <>
              <button type="button" className="btn primary" onClick={saveNoteAndClose}>
                {note.trim() ? 'Save note' : 'Done'}
              </button>
              {note.trim() && (
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
