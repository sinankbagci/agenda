import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { LogEntry, NewRow } from '../../db/types'
import { LOG_TYPES, normalizeLogEntry, pagesAfterLog, validateLogEntry } from '../../domain/log'
import { logPages } from '../../domain/progress'
import { DateInput, Field, NumberInput, Problems, Segmented, TextInput, hasErrors } from '../../ui/form'

const num = (v: number) => (Number.isFinite(v) ? v : undefined)

/** Add or edit a log entry (SPEC 4.3). Linked to a goal it counts toward it; for a book, pages move it forward. */
export function LogEntryForm({ today, entry, onDone }: { today: string; entry?: LogEntry; onDone: () => void }) {
  const goals = useLiveQuery(() => repos.goals.all(), [], [])
  const [d, setD] = useState<NewRow<LogEntry>>(entry ? (({ id: _i, ...rest }) => rest)(entry) : { date: today, type: 'other', title: '' })
  const [tried, setTried] = useState(false)
  const goal = goals.find((g) => g.id === d.goalId)
  const check = validateLogEntry(d, goals, today)

  const save = async () => {
    setTried(true)
    if (hasErrors(check)) return
    const clean = normalizeLogEntry(d)
    if (entry) await repos.logEntries.put({ ...clean, id: entry.id })
    else {
      await repos.logEntries.add(clean)
      // "read 40 pages" moves a book goal forward (only when adding, so editing doesn't double count)
      if (goal?.type === 'book' && clean.amount) await repos.goals.update(goal.id, logPages(goal, pagesAfterLog(goal, clean.amount), clean.date))
    }
    onDone()
  }

  return (
    <div className="card log-form">
      <Field label="What kind" group>
        <Segmented value={d.type as (typeof LOG_TYPES)[number]['value']} options={LOG_TYPES.map((t) => ({ value: t.value, label: `${t.icon} ${t.label}` }))} onChange={(type) => setD({ ...d, type })} />
      </Field>
      <div className="form-grid">
        <Field label="What">
          <TextInput value={d.title} placeholder={d.type === 'read' ? 'Dune' : d.type === 'watched' ? 'A documentary' : 'Went for a run'} onChange={(title) => setD({ ...d, title })} />
        </Field>
        <Field label="Day">
          <DateInput value={d.date} onChange={(date) => setD({ ...d, date })} />
        </Field>
        <Field label="Minutes (optional)">
          <NumberInput value={d.minutes ?? NaN} min={1} suffix="min" onChange={(v) => setD({ ...d, minutes: num(v) })} />
        </Field>
        <Field label={goal?.type === 'book' || d.type === 'read' ? 'Pages (optional)' : 'Amount (optional)'}>
          <NumberInput value={d.amount ?? NaN} min={1} suffix={goal?.type === 'book' || d.type === 'read' ? 'pages' : undefined} onChange={(v) => setD({ ...d, amount: num(v) })} />
        </Field>
        <Field label="Counts toward (optional)" hint="Linked time counts toward the goal’s progress and plan.">
          <select className="input" value={d.goalId ?? ''} onChange={(e) => setD({ ...d, goalId: e.target.value || undefined })}>
            <option value="">No goal</option>
            {goals
              .filter((g) => g.active || g.id === d.goalId)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <TextInput value={d.note ?? ''} onChange={(note) => setD({ ...d, note })} />
      </Field>
      <Problems check={tried ? check : { errors: [], warnings: check.warnings }} />
      <div className="button-row">
        <button type="button" className="btn primary" onClick={() => void save()}>
          {entry ? 'Save' : 'Add to log'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        {entry && (
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (window.confirm('Delete this log entry?')) {
                await repos.logEntries.remove(entry.id)
                onDone()
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
