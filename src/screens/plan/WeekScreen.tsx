import { Link, useNavigate, useParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { dayTimeline, hourRange, weekDates, type TimelineItem } from '../../domain/agenda'
import { formatDuration, fromMinutes } from '../../domain/time'
import { useNow } from '../../ui/useNow'
import { usePlanData } from './usePlanData'

const HOUR_PX = 44
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** /week and /week/:date — 7 columns, Monday first. */
export function WeekScreen() {
  const params = useParams()
  const navigate = useNavigate()
  const today = format(useNow(), 'yyyy-MM-dd')
  const anchor = params.date && ISO_RE.test(params.date) ? params.date : today
  const dates = weekDates(anchor)
  const data = usePlanData(dates[0]!, dates[6]!)
  const thisWeek = dates.includes(today)

  const byDay = dates.map((d) => (data ? dayTimeline(d, data) : []))
  const { from, to } = hourRange(byDay.flat())
  const height = (to - from) * HOUR_PX
  const y = (min: number) => ((min - from * 60) / 60) * HOUR_PX
  const go = (n: number) => navigate(`/week/${format(addDays(parseISO(anchor), 7 * n), 'yyyy-MM-dd')}`)
  const dayLink = (d: string) => (d === today ? '/today' : `/day/${d}`)

  const goalMinutes = (items: TimelineItem[]) =>
    items.filter((i) => i.kind === 'goal' || i.kind === 'review').reduce((m, i) => m + i.end - i.start, 0)

  return (
    <section className="screen week-screen">
      <div className="screen-head">
        <div>
          <h1>Week</h1>
          <p className="muted head-sub">
            {format(parseISO(dates[0]!), 'd MMM')} – {format(parseISO(dates[6]!), 'd MMM yyyy')}
          </p>
        </div>
        <div className="pager">
          <Link to={`/month/${anchor.slice(0, 7)}`} className="btn">
            Month
          </Link>
          <button type="button" className="btn" aria-label="Previous week" onClick={() => go(-1)}>
            ‹
          </button>
          {!thisWeek && (
            <Link to="/week" className="btn">
              This week
            </Link>
          )}
          <button type="button" className="btn" aria-label="Next week" onClick={() => go(1)}>
            ›
          </button>
        </div>
      </div>

      <div className="week-grid">
        <div className="week-corner" />
        {dates.map((d, i) => (
          <Link key={d} to={dayLink(d)} className={d === today ? 'week-head today' : 'week-head'}>
            <span>{format(parseISO(d), 'EEE')}</span>
            <strong>{format(parseISO(d), 'd')}</strong>
            <span className="muted week-total">{goalMinutes(byDay[i]!) ? formatDuration(goalMinutes(byDay[i]!)) : '–'}</span>
          </Link>
        ))}

        <div className="week-axis" style={{ height }}>
          {Array.from({ length: to - from }, (_, h) => (
            <span key={h} style={{ top: h * HOUR_PX }}>
              {String(from + h).padStart(2, '0')}
            </span>
          ))}
        </div>
        {dates.map((d, i) => (
          <Link key={d} to={dayLink(d)} className={d === today ? 'week-col today' : 'week-col'} style={{ height }} aria-label={`Open ${format(parseISO(d), 'EEEE d MMMM')}`}>
            {Array.from({ length: to - from }, (_, h) => (
              <span key={h} className="week-line" style={{ top: h * HOUR_PX }} />
            ))}
            {byDay[i]!.map((it) => {
              const h = Math.max(y(it.end) - y(it.start), 3)
              return (
                <span
                  key={it.id}
                  className={`wb wb-${it.kind}${it.status && it.status !== 'planned' ? ` st-${it.status}` : ''}`}
                  style={{ top: y(it.start), height: h, ...(it.color ? { background: it.color } : {}) }}
                  title={`${fromMinutes(it.start)}–${fromMinutes(it.end)} ${it.title}`}
                >
                  {h >= 18 && it.kind !== 'travel' && (
                    <span className="wb-label">
                      {it.locked ? '🔒 ' : ''}
                      {it.title}
                      {h >= 34 && <span className="wb-time">{fromMinutes(it.start)}</span>}
                    </span>
                  )}
                </span>
              )
            })}
          </Link>
        ))}
      </div>
    </section>
  )
}
