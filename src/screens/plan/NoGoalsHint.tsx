import { Link } from 'react-router-dom'
import type { DayData } from '../../domain/agenda'

/** Empty state for Week / Month: shown until there's an active goal to plan. */
export function NoGoalsHint({ data }: { data: DayData | undefined }) {
  if (!data || data.goals.some((g) => g.active && !g.completedAt)) return null
  const paused = data.goals.length > 0
  return (
    <div className="card empty-state empty-inline">
      <span>
        <strong>{paused ? 'All goals are paused or finished.' : 'Nothing to plan yet.'}</strong>{' '}
        <span className="muted">{paused ? 'Resume one to fill your free time.' : 'Add a goal and the planner fills your free time — your fixed program shows here already.'}</span>
      </span>
      <Link to={paused ? '/goals' : '/goals/new'} className="btn small primary">
        {paused ? 'Open goals' : 'Add a goal'}
      </Link>
    </div>
  )
}
