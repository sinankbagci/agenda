import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import { dayProgress, dayTimeline, nowAndNext } from '../../domain/agenda'
import { useNow } from '../../ui/useNow'
import { ProgressRing } from './ProgressRing'
import { Timeline } from './Timeline'
import { usePlanData } from './usePlanData'
import { WarningsBanner } from './WarningsBanner'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** /today and /day/:date — the timeline of one day. */
export function DayScreen() {
  const params = useParams()
  const navigate = useNavigate()
  const now = useNow()
  const today = format(now, 'yyyy-MM-dd')
  const date = params.date && ISO_RE.test(params.date) ? params.date : today
  const isToday = date === today
  const data = usePlanData(date, date)
  const goalCount = useLiveQuery(() => repos.goals.active().then((g) => g.length), [])

  const shift = (n: number) => {
    const d = format(addDays(parseISO(date), n), 'yyyy-MM-dd')
    navigate(d === today ? '/today' : `/day/${d}`)
  }

  const items = data ? dayTimeline(date, data) : []
  const { current, next } = isToday ? nowAndNext(items, now.getHours() * 60 + now.getMinutes()) : {}
  const progress = dayProgress(data?.sessions ?? [])

  return (
    <section className="screen day-screen">
      <div className="screen-head">
        <div>
          <h1>{isToday ? 'Today' : format(parseISO(date), 'EEEE')}</h1>
          <p className="muted head-sub">{format(parseISO(date), 'EEEE d MMMM yyyy')}</p>
        </div>
        <div className="pager">
          <button type="button" className="btn" aria-label="Previous day" onClick={() => shift(-1)}>
            ‹
          </button>
          {!isToday && (
            <Link to="/today" className="btn">
              Today
            </Link>
          )}
          <button type="button" className="btn" aria-label="Next day" onClick={() => shift(1)}>
            ›
          </button>
        </div>
      </div>

      {isToday && <WarningsBanner />}

      {data && progress.total > 0 && (
        <div className="card ring-card">
          <ProgressRing progress={progress} />
        </div>
      )}

      {data && goalCount === 0 && (
        <div className="card empty-state">
          <p>
            <strong>No goals yet.</strong>
          </p>
          <p className="muted">Add a goal and the planner fits it into your free time.</p>
          <Link to="/goals/new" className="btn primary">
            Add a goal
          </Link>
        </div>
      )}

      {data && items.length === 0 && goalCount !== 0 && <p className="muted">Nothing planned for this day.</p>}
      {data && items.length > 0 && <Timeline items={items} current={current} next={next} />}
    </section>
  )
}
