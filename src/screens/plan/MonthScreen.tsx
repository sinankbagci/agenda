import { Link, useNavigate, useParams } from 'react-router-dom'
import { addMonths, format, parseISO } from 'date-fns'
import { dayLoad, deadlineMarkers, monthGrid, weekdayOfIso } from '../../domain/agenda'
import { formatDuration } from '../../domain/time'
import { useNow } from '../../ui/useNow'
import { useSettings } from '../../ui/form'
import { usePlanData } from './usePlanData'
import { NoGoalsHint } from './NoGoalsHint'

const MONTH_RE = /^\d{4}-\d{2}$/
const MARK = { deadline: '📌', review: '↺', book: '📕' } as const

/** /month and /month/:yyyy-MM — calendar with load and deadline markers. */
export function MonthScreen() {
  const params = useParams()
  const navigate = useNavigate()
  const settings = useSettings()
  const today = format(useNow(), 'yyyy-MM-dd')
  const month = params.month && MONTH_RE.test(params.month) ? params.month : today.slice(0, 7)
  const grid = monthGrid(month)
  const data = usePlanData(grid[0]!.date, grid[41]!.date)
  const markers = deadlineMarkers(data?.goals ?? [])
  const go = (n: number) => navigate(`/month/${format(addMonths(parseISO(`${month}-01`), n), 'yyyy-MM')}`)

  return (
    <section className="screen month-screen">
      <div className="screen-head">
        <h1>{format(parseISO(`${month}-01`), 'MMMM yyyy')}</h1>
        <div className="pager">
          <Link to={month === today.slice(0, 7) ? '/week' : `/week/${month}-01`} className="btn">
            Week
          </Link>
          <button type="button" className="btn" aria-label="Previous month" onClick={() => go(-1)}>
            ‹
          </button>
          {month !== today.slice(0, 7) && (
            <Link to="/month" className="btn">
              This month
            </Link>
          )}
          <button type="button" className="btn" aria-label="Next month" onClick={() => go(1)}>
            ›
          </button>
        </div>
      </div>

      <NoGoalsHint data={data} />

      <div className="month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="month-dow">
            {d}
          </div>
        ))}
        {grid.map(({ date, inMonth }) => {
          const sessions = data?.sessions.filter((s) => s.date === date) ?? []
          const weekend = [0, 6].includes(weekdayOfIso(date))
          const cap = settings ? (weekend ? settings.dailyCapWeekend : settings.dailyCapWeekday) : 6
          const load = dayLoad(sessions, cap)
          const goalIds = [...new Set(sessions.filter((s) => s.goalId).map((s) => s.goalId!))]
          const goals = goalIds.map((id) => data?.goals.find((g) => g.id === id)).filter(Boolean)
          const marks = markers.get(date) ?? []
          return (
            <Link
              key={date}
              to={date === today ? '/today' : `/day/${date}`}
              className={`month-cell${inMonth ? '' : ' out'}${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}
            >
              <span className="month-num">{Number(date.slice(8))}</span>
              {load.minutes > 0 && (
                <span className="load" title={`${formatDuration(load.minutes)} planned`}>
                  <span className="load-bar" style={{ width: `${Math.max(6, load.ratio * 100)}%` }} />
                </span>
              )}
              {load.minutes > 0 && <span className="month-min muted">{formatDuration(load.minutes)}</span>}
              <span className="dots">
                {goals.slice(0, 5).map((g) => (
                  <span key={g!.id} className="dot-goal" style={{ background: g!.color }} title={g!.name} />
                ))}
              </span>
              {marks.map((m) => (
                <span key={`${m.goalId}-${m.kind}`} className={`marker marker-${m.kind}`} style={{ borderColor: m.color }}>
                  {MARK[m.kind]} {m.kind === 'review' ? `Review ${m.name}` : m.name}
                </span>
              ))}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
