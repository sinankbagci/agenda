import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Goal, Session } from '../../db/types'
import type { PlanWarning } from '../../domain/planner'
import { deadlineProgress, streak, type DeadlineProgress, type Streak } from '../../domain/progress'
import { formatDuration } from '../../domain/time'

const STATUS_TEXT: Record<DeadlineProgress['status'], string> = {
  done: '✓ Done',
  ahead: '↑ Ahead',
  onTrack: '✓ On track',
  behind: '⚠︎ Behind',
  atRisk: '⚠︎ Won’t fit',
}

/** Planner shortfall for a goal (from the last plan's warnings). */
export function useShortfall(goalId: string): number {
  return (
    useLiveQuery(async () => {
      const row = await db.meta.get('planWarnings')
      const ws: PlanWarning[] = row ? JSON.parse(row.value) : []
      const w = ws.find((x) => x.kind === 'deadlineShortfall' && x.goalId === goalId)
      return w?.kind === 'deadlineShortfall' ? w.shortfallMinutes : 0
    }, [goalId]) ?? 0
  )
}

export function DeadlineBadge({ p }: { p: DeadlineProgress }) {
  const extra = p.status === 'behind' ? ` by ${formatDuration(p.gapMinutes)}` : p.status === 'atRisk' ? ` — ${formatDuration(p.gapMinutes)} short` : ''
  return (
    <span className={`status-badge st-${p.status}`}>
      {STATUS_TEXT[p.status]}
      {extra}
    </span>
  )
}

export function ProgressBar({ ratio, label }: { ratio: number; label: string }) {
  return (
    <span className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </span>
  )
}

export function StreakChip({ s }: { s: Streak }) {
  const unit = (n: number) => `${n} ${s.unit}${n === 1 ? '' : 's'}`
  return (
    <span className={s.current ? 'streak on' : 'streak'} title={`Best: ${unit(s.best)}`}>
      🔥 {s.current ? `${s.current}-${s.unit} streak` : 'No streak yet'}
      {s.best > s.current ? <span className="muted"> · best {unit(s.best)}</span> : null}
    </span>
  )
}

/** Compact progress line for goal cards. */
export function CardProgress({ goal, sessions, today }: { goal: Goal; sessions: readonly Session[]; today: string }) {
  const shortfall = useShortfall(goal.id)
  if (goal.type === 'deadline') {
    const p = deadlineProgress(goal, sessions, today, shortfall)
    return (
      <span className="card-progress">
        <ProgressBar ratio={p.ratio} label={`${goal.name}: ${Math.round(p.ratio * 100)}% of the hours done`} />
        <span className="muted small">
          {formatDuration(p.doneMinutes)} / {formatDuration(p.totalMinutes)}
        </span>
        <DeadlineBadge p={p} />
      </span>
    )
  }
  if (goal.type === 'book') {
    const ratio = goal.totalPages ? (goal.pagesDone ?? 0) / goal.totalPages : 0
    return (
      <span className="card-progress">
        <ProgressBar ratio={ratio} label={`${goal.name}: page ${goal.pagesDone ?? 0} of ${goal.totalPages}`} />
        <span className="muted small">{Math.round(ratio * 100)}% read</span>
        {(() => {
          const s = streak(goal, sessions, today)
          return s ? <StreakChip s={s} /> : null
        })()}
      </span>
    )
  }
  const s = streak(goal, sessions, today)
  return s ? (
    <span className="card-progress">
      <StreakChip s={s} />
    </span>
  ) : null
}
