import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { GOAL_TYPES, describeGoal } from '../../domain/goals'
import { bookProgress, completionRate, deadlineProgress, logPages, streak, totalInvested, validatePages, weeklyHistory, weeklyTarget } from '../../domain/progress'
import { formatDuration } from '../../domain/time'
import { NumberInput } from '../../ui/form'
import { useNow } from '../../ui/useNow'
import { beginFocus } from '../focus/FocusScreen'
import { GoalNotes } from './GoalNotes'
import { TopicsSection } from './TopicsSection'
import { WeeklyChart } from './WeeklyChart'
import { DeadlineBadge, ProgressBar, StreakChip, useShortfall } from './GoalProgress'

/** /goals/:id — progress, streaks, history chart, stats, topics and notes (SPEC 4.2). */
export function GoalDetailScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const today = format(useNow(), 'yyyy-MM-dd')
  const goal = useLiveQuery(() => repos.goals.get(id).then((g) => g ?? null), [id])
  const sessions = useLiveQuery(() => db.sessions.where('goalId').equals(id).toArray(), [id], [])
  const shortfall = useShortfall(id)

  if (goal === undefined) return null
  if (goal === null)
    return (
      <section className="screen">
        <Link to="/goals" className="back">
          ‹ Goals
        </Link>
        <h1>Goal not found</h1>
      </section>
    )

  const invested = totalInvested(goal.id, sessions)
  const rate = completionRate(goal.id, sessions, today)
  const history = weeklyHistory(goal.id, sessions, today, 12)
  const thisWeek = history.at(-1)?.minutes ?? 0

  return (
    <section className="screen goal-detail" style={{ ['--goal' as string]: goal.color }}>
      <Link to="/goals" className="back">
        ‹ Goals
      </Link>
      <div className="screen-head">
        <div className="detail-title">
          <span className="goal-icon" aria-hidden>
            {goal.icon ?? goal.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1>{goal.name}</h1>
            <p className="muted head-sub">
              {GOAL_TYPES.find((t) => t.value === goal.type)!.label} · {describeGoal(goal, today)}
              {!goal.active && ' · paused'}
            </p>
          </div>
        </div>
        <div className="pager">
          {goal.active && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await beginFocus(goal.id)
                navigate('/focus')
              }}
            >
              ◷ Focus
            </button>
          )}
          <Link to={`/goals/${goal.id}/edit`} className="btn primary">
            Edit
          </Link>
        </div>
      </div>

      {/* ---- progress by type ---- */}
      {goal.type === 'deadline' && <DeadlineCard p={deadlineProgress(goal, sessions, today, shortfall)} deadline={goal.deadline} />}
      {goal.type === 'book' && <BookCard goalId={goal.id} today={today} />}
      {(() => {
        const s = streak(goal, sessions, today)
        return s ? (
          <div className="card detail-card">
            <StreakChip s={s} />
            <p className="muted small">
              {s.unit === 'week'
                ? 'Weeks where you hit your target. Rest days never break it; weeks with nothing planned are skipped.'
                : 'Days where you did what was planned. Days with nothing planned (no free time) are skipped.'}
            </p>
          </div>
        ) : null
      })()}

      {/* ---- stats ---- */}
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Total time</span>
          <span className="stat-value">{formatDuration(Math.round(invested))}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sessions done</span>
          <span className="stat-value">{rate.total ? `${Math.round(rate.rate * 100)}%` : '–'}</span>
          <span className="muted small">
            {rate.done} of {rate.total}
            {rate.partial ? ` · ${rate.partial} partly` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">This week</span>
          <span className="stat-value">{formatDuration(thisWeek)}</span>
        </div>
      </div>

      <h2>Minutes per week</h2>
      <div className="card">
        <WeeklyChart data={history} target={weeklyTarget(goal)} color={goal.color} />
      </div>

      {goal.type === 'deadline' && <TopicsSection goalId={goal.id} totalHours={goal.totalHours ?? 0} />}
      <GoalNotes goalId={goal.id} />
    </section>
  )
}

function DeadlineCard({ p, deadline }: { p: ReturnType<typeof deadlineProgress>; deadline?: string }) {
  return (
    <div className="card detail-card">
      <div className="detail-progress-head">
        <strong>
          {formatDuration(p.doneMinutes)} of {formatDuration(p.totalMinutes)}
        </strong>
        <DeadlineBadge p={p} />
      </div>
      <ProgressBar ratio={p.ratio} label={`${Math.round(p.ratio * 100)}% of the hours done`} />
      <p className="muted small">
        {p.daysLeft} day{p.daysLeft === 1 ? '' : 's'} left{deadline ? ` (until ${format(parseISO(deadline), 'EEE d MMM')})` : ''} · by now the plan expects about{' '}
        {formatDuration(p.expectedMinutes)}
      </p>
    </div>
  )
}

function BookCard({ goalId, today }: { goalId: string; today: string }) {
  const goal = useLiveQuery(() => repos.goals.get(goalId), [goalId])
  const [page, setPage] = useState<number>(NaN)
  const [err, setErr] = useState<string>()
  if (!goal) return null
  const b = bookProgress(goal, today)
  const save = async () => {
    const e = validatePages(page, goal.totalPages)
    setErr(e)
    if (e) return
    await repos.goals.update(goal.id, logPages(goal, page, today))
    setPage(NaN)
  }
  return (
    <div className="card detail-card">
      <div className="detail-progress-head">
        <strong>
          Page {b.pagesDone} of {b.totalPages}
        </strong>
        <span className="muted">{Math.round(b.ratio * 100)}%</span>
      </div>
      <ProgressBar ratio={b.ratio} label={`Page ${b.pagesDone} of ${b.totalPages}`} />
      <p className="muted small">
        {b.pace
          ? `About ${b.pace} pages a day lately → finishing around ${format(parseISO(b.finishDate!), 'EEE d MMM')}${
              b.onTrack === undefined ? '' : b.onTrack ? ' — before your target date.' : ' — after your target date.'
            }`
          : 'Update your page now and then to see your pace and an estimated finish date.'}
      </p>
      <div className="page-log">
        <span>I’m on page</span>
        <NumberInput value={page} min={0} max={goal.totalPages} onChange={setPage} />
        <button type="button" className="btn primary" onClick={() => void save()}>
          Update
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  )
}
