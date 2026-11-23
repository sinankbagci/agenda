import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import type { Goal, Priority } from '../../db/types'
import type { PlanWarning } from '../../domain/planner'
import { lastWeekSummary, nextWeekPreview, reviewWeek } from '../../domain/review'
import { formatDuration } from '../../domain/time'
import { NumberInput, Segmented } from '../../ui/form'
import { useNow } from '../../ui/useNow'
import { OverridesSection } from '../setup/AvailabilitySection'
import { DeadlineBadge } from '../goals/GoalProgress'

const day = (d: string, f = 'd MMM') => format(parseISO(d), f)

/** /review — weekly review (SPEC 4.4): last week, next week, quick adjustments, Confirm week. */
export function WeeklyReviewScreen() {
  const navigate = useNavigate()
  const today = format(useNow(), 'yyyy-MM-dd')
  const week = reviewWeek(today)
  const weekEnd = format(addDays(parseISO(week), 6), 'yyyy-MM-dd')
  const data = useLiveQuery(async () => {
    const [goals, sessions, logs, checkIns, reviews, w] = await Promise.all([
      repos.goals.all(),
      repos.sessions.all(),
      repos.logEntries.all(),
      repos.checkIns.all(),
      repos.weeklyReviews.all(),
      db.meta.get('planWarnings'),
    ])
    const warnings: PlanWarning[] = w ? JSON.parse(w.value) : []
    return { goals, sessions, logs, checkIns, reviews, warnings }
  }, [])
  const [adjustments, setAdjustments] = useState<string[]>([])
  if (!data) return null

  const shortfalls = new Map(data.warnings.flatMap((w) => (w.kind === 'deadlineShortfall' ? [[w.goalId, w.shortfallMinutes] as const] : [])))
  const last = lastWeekSummary({ week, goals: data.goals, sessions: data.sessions, logs: data.logs, checkIns: data.checkIns, shortfalls, today })
  const next = nextWeekPreview(week, data.goals, data.sessions)
  const confirmed = data.reviews.find((r) => r.weekStart === week)
  const maxGoal = Math.max(1, ...last.perGoal.map((g) => g.minutes))
  const maxDay = Math.max(60, ...next.days.map((d) => d.minutes))
  const issues = data.warnings.filter((w) => w.kind !== 'setup')
  const note = (s: string) => setAdjustments((a) => [...a.filter((x) => x !== s), s])

  const confirm = async () => {
    await repos.weeklyReviews.put({ weekStart: week, confirmedAt: Date.now(), adjustments })
    navigate('/today')
  }

  return (
    <section className="screen review-screen">
      <div className="screen-head">
        <div>
          <h1>Weekly review</h1>
          <p className="muted head-sub">
            Planning {day(week)} – {day(weekEnd, 'd MMM yyyy')}
            {confirmed && ` · confirmed ${format(confirmed.confirmedAt, 'EEE d MMM')} ✓`}
          </p>
        </div>
      </div>

      {/* ---------- Last week ---------- */}
      <h2>
        Last week · {day(last.from)} – {day(last.to)}
      </h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Time on goals</span>
          <span className="stat-value">{formatDuration(last.totalMinutes)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sessions done</span>
          <span className="stat-value">
            {last.sessions.done} <span className="stat-of">of {last.sessions.planned}</span>
          </span>
          <span className="muted small">
            {[last.sessions.partial && `${last.sessions.partial} partly`, last.sessions.skipped && `${last.sessions.skipped} skipped`, last.sessions.missed && `${last.sessions.missed} missed`]
              .filter(Boolean)
              .join(' · ') || ' '}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Energy · mood</span>
          <span className="stat-value">{last.checkIns.count ? `${last.checkIns.energy} · ${last.checkIns.mood}` : '–'}</span>
          <span className="muted small">{last.checkIns.count ? `average of ${last.checkIns.count} check-in${last.checkIns.count === 1 ? '' : 's'} (1–5)` : 'no check-ins'}</span>
        </div>
      </div>

      {last.perGoal.length > 0 ? (
        <div className="card">
          <h3>Time per goal</h3>
          <ul className="hbars">
            {last.perGoal.map((g) => (
              <li key={g.goalId} style={{ ['--goal' as string]: g.color }}>
                <span className="hbar-label">{g.name}</span>
                <span className="hbar-track">
                  <span className="hbar" style={{ width: `${(g.minutes / maxGoal) * 100}%` }} />
                </span>
                <span className="hbar-value">{formatDuration(g.minutes)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">By category: {last.perCategory.map((c) => `${c.category} ${formatDuration(c.minutes)}`).join(' · ')}</p>
        </div>
      ) : (
        <p className="muted">Nothing recorded last week.</p>
      )}

      {last.streaks.length > 0 && (
        <ul className="review-list">
          {last.streaks.map((s) => (
            <li key={s.goalId}>
              {s.status === 'broken' ? '💔' : '🔥'} <strong>{s.name}</strong>{' '}
              {s.status === 'broken'
                ? `— streak broken (was ${s.before} ${s.unit}${s.before === 1 ? '' : 's'})`
                : s.status === 'started'
                  ? `— new streak: ${s.after} ${s.unit}${s.after === 1 ? '' : 's'}`
                  : `— streak kept: ${s.after} ${s.unit}s`}
            </li>
          ))}
        </ul>
      )}
      {last.behind.length > 0 && (
        <ul className="review-list">
          {last.behind.map((b) => (
            <li key={b.goalId}>
              <Link to={`/goals/${b.goalId}`}>{b.name}</Link> <DeadlineBadge p={b.progress} />
            </li>
          ))}
        </ul>
      )}

      {/* ---------- Next week ---------- */}
      <h2>
        The week of {day(week)} · {formatDuration(next.totalMinutes)} planned
      </h2>
      <div className="card">
        <ul className="week-preview" aria-label="Planned time per day">
          {next.days.map((d) => (
            <li key={d.date}>
              <Link to={d.date === today ? '/today' : `/day/${d.date}`} aria-label={`${day(d.date, 'EEEE')}: ${formatDuration(d.minutes)}`}>
                <span className="wp-value">{d.minutes ? formatDuration(d.minutes) : '–'}</span>
                <span className="wp-track">
                  <span className="wp-bar" style={{ height: `${(d.minutes / maxDay) * 100}%` }} />
                </span>
                <span className="wp-day">{day(d.date, 'EEE')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {next.deadlines.length > 0 && (
        <ul className="review-list">
          {next.deadlines.map((d) => (
            <li key={d.goalId}>
              {d.kind === 'task' ? '📋' : d.kind === 'book' ? '📕' : '📌'} <Link to={`/goals/${d.goalId}`}>{d.name}</Link> — {d.kind === 'task' ? 'do it by' : 'due'} {day(d.date, 'EEE d MMM')}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <div className="card review-issues">
          {issues.map((w) => (
            <p key={w.message}>⚠︎ {w.message}</p>
          ))}
        </div>
      )}

      {/* ---------- Quick adjustments ---------- */}
      <h2>Quick adjustments</h2>
      <p className="muted">Changes apply right away and the plan updates.</p>
      <div className="list adjust-list">
        {data.goals
          .filter((g) => !g.oneOff)
          .map((g) => (
            <AdjustRow key={g.id} goal={g} onChange={note} />
          ))}
      </div>
      <h3>Busy or free time in that week</h3>
      <OverridesSection from={week} to={weekEnd} />

      <div className="confirm-row">
        {adjustments.length > 0 && <p className="muted small">Changes: {adjustments.join(' · ')}</p>}
        <button type="button" className="btn primary big" onClick={() => void confirm()}>
          {confirmed ? 'Confirm again' : 'Confirm week'}
        </button>
      </div>
    </section>
  )
}

function AdjustRow({ goal, onChange }: { goal: Goal; onChange: (note: string) => void }) {
  const [hours, setHours] = useState(goal.totalHours ?? NaN)
  return (
    <div className={goal.active ? 'adjust-row' : 'adjust-row paused'} style={{ ['--goal' as string]: goal.color }}>
      <strong className="adjust-name">{goal.name}</strong>
      <Segmented<`${Priority}`>
        value={`${goal.priority}`}
        options={[
          { value: '1', label: 'Low' },
          { value: '2', label: 'Med' },
          { value: '3', label: 'High' },
        ]}
        onChange={(v) => {
          void repos.goals.update(goal.id, { priority: Number(v) as Priority })
          onChange(`${goal.name}: ${v === '3' ? 'high' : v === '2' ? 'medium' : 'low'} priority`)
        }}
      />
      {goal.type === 'deadline' && (
        <span className="adjust-hours">
          <NumberInput value={hours} step={0.5} min={0.5} suffix="h" onChange={setHours} />
          {Number.isFinite(hours) && hours > 0 && hours !== goal.totalHours && (
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                void repos.goals.update(goal.id, { totalHours: hours })
                onChange(`${goal.name}: ${hours}h`)
              }}
            >
              Save
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        className="btn small"
        onClick={() => {
          void repos.goals.update(goal.id, { active: !goal.active })
          onChange(`${goal.name}: ${goal.active ? 'paused' : 'resumed'}`)
        }}
      >
        {goal.active ? 'Pause' : 'Resume'}
      </button>
    </div>
  )
}
