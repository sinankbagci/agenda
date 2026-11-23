import type { DayProgress } from '../../domain/agenda'
import { formatDuration } from '../../domain/time'

export function ProgressRing({ progress }: { progress: DayProgress }) {
  const r = 34
  const c = 2 * Math.PI * r
  const pct = Math.round(progress.ratio * 100)
  return (
    <div className="ring-wrap">
      <svg className="ring" viewBox="0 0 80 80" role="img" aria-label={`${pct}% of today’s planned work done`}>
        <circle cx="40" cy="40" r={r} className="ring-track" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress.ratio)}
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="45" textAnchor="middle" className="ring-text">
          {pct}%
        </text>
      </svg>
      <div>
        <strong>
          {progress.done} of {progress.total} session{progress.total === 1 ? '' : 's'} done
        </strong>
        <div className="muted">
          {formatDuration(progress.doneMinutes)} of {formatDuration(progress.plannedMinutes)} planned
        </div>
      </div>
    </div>
  )
}
