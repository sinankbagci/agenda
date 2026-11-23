import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import { describeQuick, parseQuickAdd, quickToTask } from '../../domain/quickAdd'
import { AddToDaySheet } from '../plan/AddToDaySheet'

const EXAMPLES = ['Algebra midterm Dec 12 15h', 'Workout 4x week 45m gym', 'Read 30m daily', 'Book Dune 412 pages by Jan 31', 'Homework 2h tomorrow']

/**
 * Quick add (SPEC 3.5): type one line, see what was understood, then confirm in the pre-filled
 * form (goals) or the task form (one-off tasks).
 */
export function QuickAdd() {
  const navigate = useNavigate()
  const today = format(new Date(), 'yyyy-MM-dd')
  const locations = useLiveQuery(() => repos.locations.all(), [], [])
  const [text, setText] = useState('')
  const [task, setTask] = useState<ReturnType<typeof quickToTask> | null>(null)
  const r = parseQuickAdd(text, today, locations)

  const go = () => {
    if (!text.trim()) return
    if (r.kind === 'task') return setTask(quickToTask(r, today))
    if (r.kind === 'unknown') return navigate(`/goals/new?name=${encodeURIComponent(r.name)}`)
    navigate(`/goals/new?quick=${encodeURIComponent(text.trim())}`)
  }

  return (
    <div className="card quick-add">
      <form
        className="quick-row"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <input
          className="input"
          type="text"
          enterKeyHint="go"
          autoCapitalize="sentences"
          aria-label="Quick add"
          placeholder="Quick add — e.g. “Workout 4x week 45m gym”"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={!text.trim()}>
          Continue
        </button>
      </form>
      {text.trim() ? (
        <p className="quick-preview" aria-live="polite">
          <strong>{r.name || '…'}</strong> — {describeQuick(r, locations)}
          {r.missing.length > 0 && r.kind !== 'unknown' && <span className="muted"> · still needed: {r.missing.join(', ')}</span>}
        </p>
      ) : (
        <p className="muted small quick-examples">
          Try:{' '}
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="example" onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </p>
      )}
      {task && (
        <AddToDaySheet
          date={today}
          today={today}
          initialTask={task}
          onClose={() => setTask(null)}
          onSaved={() => {
            setTask(null)
            setText('')
          }}
        />
      )}
    </div>
  )
}
