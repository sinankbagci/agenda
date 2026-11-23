import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { Goal, Session } from '../../db/types'
import { CATEGORIES } from '../../domain/goals'
import { finishTask, goalToTask, taskDoBy, taskToGoal, validateTask, type TaskDraft } from '../../domain/oneOff'
import { formatDuration } from '../../domain/time'
import { enqueueReplan } from '../../app/usePlanKeeper'
import { DateInput, Field, NumberInput, Problems, Segmented, TextInput, hasErrors } from '../../ui/form'

/** Finish a task from anywhere (list, detail): completes it and drops what's still planned. */
export async function finishTaskNow(goal: Goal) {
  const all = await repos.sessions.byGoal(goal.id)
  const r = finishTask(goal, all, undefined, Date.now())
  await repos.goals.update(goal.id, r.goal)
  for (const id of r.removeIds) await repos.sessions.remove(id)
  void enqueueReplan()
}

export async function reopenTask(goal: Goal) {
  await repos.goals.update(goal.id, { completedAt: undefined })
  void enqueueReplan({ includeToday: true })
}

/** A task row on the Goals tab. */
export function TaskRow({ goal, sessions }: { goal: Goal; sessions: readonly Session[] }) {
  const done = sessions.filter((s) => s.goalId === goal.id && (s.status === 'done' || s.status === 'partial')).reduce((m, s) => m + (s.actualMinutes ?? 0), 0)
  const total = Math.round((goal.totalHours ?? 0) * 60)
  return (
    <div className={goal.completedAt ? 'task-row done' : 'task-row'} style={{ ['--goal' as string]: goal.color }}>
      <Link to={`/goals/${goal.id}`} className="task-main">
        <strong>📋 {goal.name}</strong>
        <span className="muted small">
          {formatDuration(total)}
          {done > 0 ? ` · ${formatDuration(done)} done` : ''} · {goal.completedAt ? `finished ${format(goal.completedAt, 'EEE d MMM')}` : `do it by ${taskDoBy(goal)}`}
        </span>
      </Link>
      {goal.completedAt ? (
        <span className="badge">✓ Done</span>
      ) : (
        <button type="button" className="btn small primary" onClick={() => void finishTaskNow(goal)}>
          ✓ Finished
        </button>
      )}
    </div>
  )
}

/** Edit a task in its own small form (it isn't edited as a deadline goal). */
export function TaskEditCard({ goal, today, onDone }: { goal: Goal; today: string; onDone: () => void }) {
  const navigate = useNavigate()
  const [d, setD] = useState<TaskDraft>(goalToTask(goal))
  const [tried, setTried] = useState(false)
  const check = validateTask(d, goal.completedAt ? d.doBy : today)
  const save = async () => {
    setTried(true)
    if (hasErrors(check)) return
    const { createdAt: _c, color: _col, ...rest } = taskToGoal(d, goal.color, goal.createdAt)
    await repos.goals.update(goal.id, rest)
    void enqueueReplan({ includeToday: true })
    onDone()
  }
  return (
    <div className="card">
      <div className="form-grid">
        <Field label="What">
          <TextInput value={d.title} onChange={(title) => setD({ ...d, title })} />
        </Field>
        <Field label="How long" hint={formatDuration(Number.isFinite(d.minutes) ? d.minutes : 0)}>
          <NumberInput value={d.minutes} min={10} step={15} suffix="min" onChange={(minutes) => setD({ ...d, minutes })} />
        </Field>
        <Field label="Do it by">
          <DateInput value={d.doBy} onChange={(doBy) => setD({ ...d, doBy })} />
        </Field>
        <Field label="Category">
          <select className="input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as TaskDraft['category'] })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Focus" group>
        <Segmented
          value={d.focus}
          options={[
            { value: 'demanding', label: 'Demanding' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={(focus) => setD({ ...d, focus })}
        />
      </Field>
      <Problems check={tried ? check : { errors: [], warnings: [] }} />
      <div className="button-row">
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={async () => {
            if (!window.confirm(`Delete the task “${goal.name}”?`)) return
            await repos.goals.remove(goal.id)
            navigate('/goals', { replace: true })
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
