import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { Goal } from '../../db/types'
import { GoalCard } from './GoalCard'
import { TaskRow } from './TaskParts'
import { QuickAdd } from './QuickAdd'

/** Higher priority first, then nearest deadline, then name. */
export const goalOrder = (a: Goal, b: Goal) =>
  b.priority - a.priority || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.name.localeCompare(b.name)

export function GoalsScreen() {
  const goals = useLiveQuery(() => repos.goals.all(), [])
  const sessions = useLiveQuery(() => repos.sessions.all(), [], [])
  const logs = useLiveQuery(() => repos.logEntries.all(), [], [])
  const today = format(new Date(), 'yyyy-MM-dd')
  if (!goals) return null
  const active = goals.filter((g) => g.active && !g.oneOff).sort(goalOrder)
  const paused = goals.filter((g) => !g.active && !g.oneOff).sort(goalOrder)
  const tasks = goals.filter((g) => g.oneOff && !g.completedAt).sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''))
  const doneTasks = goals.filter((g) => g.oneOff && g.completedAt).sort((a, b) => b.completedAt! - a.completedAt!)

  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Goals</h1>
        <Link to="/goals/new" className="btn primary">
          + New goal
        </Link>
      </div>
      <QuickAdd />
      {goals.filter((g) => !g.oneOff).length === 0 && tasks.length === 0 && (
        <div className="card empty-state">
          <p>
            <strong>No goals yet.</strong>
          </p>
          <p className="muted">Add an exam, a workout routine, daily reading or a book — the planner fits them into your free time.</p>
          <Link to="/goals/new" className="btn primary">
            Add your first goal
          </Link>
        </div>
      )}
      {tasks.length > 0 && (
        <>
          <h2>📋 Tasks</h2>
          <div className="goal-list">
            {tasks.map((g) => (
              <TaskRow key={g.id} goal={g} sessions={sessions} />
            ))}
          </div>
        </>
      )}
      {(tasks.length > 0 || doneTasks.length > 0) && active.length > 0 && <h2>Goals</h2>}
      {active.length > 0 && (
        <div className="goal-list">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} to={`/goals/${g.id}`} today={today} sessions={sessions} logs={logs} />
          ))}
        </div>
      )}
      {paused.length > 0 && (
        <>
          <h2>Paused</h2>
          <p className="muted">Paused goals aren’t planned until you resume them.</p>
          <div className="goal-list">
            {paused.map((g) => (
              <GoalCard key={g.id} goal={g} to={`/goals/${g.id}`} today={today} sessions={sessions} logs={logs} />
            ))}
          </div>
        </>
      )}
      {doneTasks.length > 0 && (
        <details className="done-tasks">
          <summary>Done tasks ({doneTasks.length})</summary>
          <div className="goal-list">
            {doneTasks.slice(0, 20).map((g) => (
              <TaskRow key={g.id} goal={g} sessions={sessions} />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
