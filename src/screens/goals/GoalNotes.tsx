import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import { notesOf } from '../../domain/sessions'
import { formatDuration } from '../../domain/time'

/** All session notes of a goal, newest first (SPEC 4.1). */
export function GoalNotes({ goalId }: { goalId: string }) {
  const notes = useLiveQuery(() => repos.sessions.byGoal(goalId).then((all) => notesOf(goalId, all)), [goalId])
  if (!notes?.length) return null
  return (
    <>
      <h2>Session notes</h2>
      <ul className="list notes-list">
        {notes.map((n) => (
          <li key={n.id} className="list-item note-item">
            <span className="row-main">
              <span className="muted small">
                {format(parseISO(n.date), 'EEE d MMM')} · {n.start}
                {n.actualMinutes !== undefined ? ` · ${formatDuration(n.actualMinutes)}` : ''}
              </span>
              <span>{n.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
