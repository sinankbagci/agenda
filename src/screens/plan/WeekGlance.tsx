import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { weekDates } from '../../domain/agenda'
import { nextWeekPreview } from '../../domain/review'
import { formatDuration, toMinutes } from '../../domain/time'
import { usePlanData } from './usePlanData'

/**
 * Landscape side panel next to Today (SPEC: "Today on left, Week on right"): the week's days
 * with planned goal time and progress, then deadlines coming up. Hidden in portrait (CSS).
 */
export function WeekGlance({ today }: { today: string }) {
  const dates = weekDates(today)
  const data = usePlanData(dates[0]!, dates[6]!)
  if (!data) return null
  const goal = (id?: string) => data.goals.find((g) => g.id === id)
  const deadlines = nextWeekPreview(dates[0]!, data.goals, data.sessions).deadlines.filter((d) => d.date >= today)

  return (
    <aside className="week-glance" aria-label="This week">
      <div className="glance-head">
        <h2>This week</h2>
        <Link to="/week" className="btn small link">
          Open week
        </Link>
      </div>
      <ul className="glance-days">
        {dates.map((d) => {
          const work = data.sessions.filter((s) => s.date === d && (s.kind === 'goal' || s.kind === 'review') && s.status !== 'skipped')
          const minutes = work.reduce((m, s) => m + toMinutes(s.end) - toMinutes(s.start), 0)
          const done = work.filter((s) => s.status === 'done').length
          const past = d < today
          return (
            <li key={d} className={d === today ? 'is-today' : past ? 'is-past' : undefined}>
              <Link to={d === today ? '/today' : `/day/${d}`} className="glance-day">
                <span className="glance-date">
                  <strong>{format(parseISO(d), 'EEE')}</strong>
                  <span className="muted small">{format(parseISO(d), 'd MMM')}</span>
                </span>
                <span className="glance-dots" aria-hidden>
                  {work.slice(0, 6).map((s) => (
                    <span key={s.id} className={s.status === 'done' ? 'glance-dot done' : 'glance-dot'} style={{ ['--goal' as string]: goal(s.goalId)?.color }} />
                  ))}
                </span>
                <span className="glance-time">
                  {minutes ? formatDuration(minutes) : <span className="muted">free</span>}
                  {work.length > 0 && (past || d === today) && <span className="muted small"> · {done}/{work.length} done</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {deadlines.length > 0 && (
        <>
          <h2>Coming up</h2>
          <ul className="glance-deadlines">
            {deadlines.map((d) => (
              <li key={d.goalId}>
                <span aria-hidden>{d.kind === 'task' ? '📋' : d.kind === 'book' ? '📕' : '📌'} </span>
                <Link to={`/goals/${d.goalId}`}>{d.name}</Link>
                <span className="muted small"> · {d.date === today ? 'today' : format(parseISO(d.date), 'EEE d MMM')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
