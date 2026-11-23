import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import { stars } from '../../domain/log'
import { formatDuration } from '../../domain/time'
import { bestStreaks, deadlinesMet, heatmapWeeks, minutesByDay, moodByMonth, watchedAndRead, yearTotals, yearsWithData } from '../../domain/yearReview'
import { useNow } from '../../ui/useNow'
import { ReviewTabs } from './ReviewTabs'
import { YearHeatmap } from './YearHeatmap'
import { MoodChart } from './MoodChart'

const TYPE_ICON: Record<string, string> = { movie: '🎬', series: '📺', book: '📖', article: '📰', course: '🎓', watched: '🎬', read: '📖' }

/** /review/year — Year in review (SPEC 4.6). */
export function YearReviewScreen() {
  const today = format(useNow(), 'yyyy-MM-dd')
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const data = useLiveQuery(async () => {
    const [goals, sessions, logs, checkIns, items] = await Promise.all([repos.goals.all(), repos.sessions.all(), repos.logEntries.all(), repos.checkIns.all(), repos.backlogItems.all()])
    return { goals, sessions, logs, checkIns, items }
  }, [])
  if (!data) return null

  const { goals, sessions, logs, checkIns, items } = data
  const years = yearsWithData(sessions, logs, checkIns, thisYear)
  const totals = yearTotals(year, goals, sessions, logs)
  const weeks = heatmapWeeks(year, minutesByDay(year, sessions, logs))
  const streaks = bestStreaks(year, goals, sessions, logs, today).slice(0, 6)
  const deadlines = deadlinesMet(year, goals, sessions, logs, today)
  const met = deadlines.filter((d) => d.met).length
  const media = watchedAndRead(year, items, logs)
  const moods = moodByMonth(year, checkIns)
  const maxGoal = Math.max(1, ...totals.perGoal.map((g) => g.minutes))
  const hours = Math.round(totals.minutes / 60)

  return (
    <section className="screen review-screen year-screen">
      <ReviewTabs />
      <div className="screen-head">
        <div>
          <h1>Year in review</h1>
          <p className="muted head-sub">{year === thisYear ? `${year} so far` : `${year}`}</p>
        </div>
        {years.length > 1 && (
          <label className="year-pick">
            <select className="input" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Time on goals</span>
          <span className="stat-value">{hours >= 10 ? `${hours} h` : formatDuration(totals.minutes)}</span>
          <span className="muted small">
            {totals.activeDays} active day{totals.activeDays === 1 ? '' : 's'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Sessions done</span>
          <span className="stat-value">{totals.sessionsDone}</span>
          <span className="muted small">longest run: {totals.longestRun} day{totals.longestRun === 1 ? '' : 's'} in a row</span>
        </div>
        <div className="stat">
          <span className="stat-label">Deadlines met</span>
          <span className="stat-value">
            {met} <span className="stat-of">of {deadlines.length}</span>
          </span>
          <span className="muted small">{deadlines.length ? 'goals and tasks due this year' : 'none due yet'}</span>
        </div>
      </div>

      <h2>Every day</h2>
      <div className="card">
        <YearHeatmap weeks={weeks} year={year} />
      </div>

      <h2>Time per goal</h2>
      {totals.perGoal.length ? (
        <div className="card">
          <ul className="hbars">
            {totals.perGoal.map((g) => (
              <li key={g.goalId} style={{ ['--goal' as string]: g.color }}>
                <span className="hbar-label">
                  <Link to={`/goals/${g.goalId}`}>{g.name}</Link>
                </span>
                <span className="hbar-track">
                  <span className="hbar" style={{ width: `${(g.minutes / maxGoal) * 100}%` }} />
                </span>
                <span className="hbar-value">{formatDuration(g.minutes)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">By category: {totals.perCategory.map((c) => `${c.category} ${formatDuration(c.minutes)}`).join(' · ')}</p>
        </div>
      ) : (
        <p className="muted">Nothing recorded in {year} yet.</p>
      )}

      {streaks.length > 0 && (
        <>
          <h2>Best streaks</h2>
          <ul className="review-list">
            {streaks.map((s) => (
              <li key={s.goalId}>
                🔥 <strong>{s.name}</strong> — {s.best} {s.unit}
                {s.best === 1 ? '' : 's'} in a row
              </li>
            ))}
          </ul>
        </>
      )}

      {deadlines.length > 0 && (
        <>
          <h2>Deadlines</h2>
          <ul className="review-list">
            {deadlines.map((d) => (
              <li key={d.goalId}>
                {d.met ? '✅' : '⏱'} {d.task && '📋 '}
                <Link to={`/goals/${d.goalId}`}>{d.name}</Link> — {format(parseISO(d.deadline), 'd MMM')} · {d.met ? 'met' : 'not finished in time'}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Watched &amp; read</h2>
      {media.length ? (
        <ul className="review-list media-list">
          {media.map((m, i) => (
            <li key={`${m.title}-${m.date}-${i}`}>
              <span aria-hidden>{TYPE_ICON[m.type] ?? (m.list === 'watch' ? '🎬' : '📖')} </span>
              <strong>{m.title}</strong>
              {m.rating && (
                <span className="media-stars" aria-label={`${m.rating} out of 5`}>
                  {' '}
                  {stars(m.rating)}
                </span>
              )}
              <span className="muted small"> · {format(parseISO(m.date), 'd MMM')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Nothing finished yet — mark items finished in <Link to="/lists">Lists</Link> or log them.
        </p>
      )}

      <h2>Energy &amp; mood by month</h2>
      {moods.some((m) => m.count) ? (
        <div className="card">
          <MoodChart data={moods} year={year} />
        </div>
      ) : (
        <p className="muted">No check-ins in {year} yet — Today asks “How was today?” in the evening.</p>
      )}
    </section>
  )
}
