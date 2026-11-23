import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { formatDuration } from '../../domain/time'

/**
 * Minutes per week (single series) — dataviz specs: columns ≤ 24px, 4px rounded data-end and
 * square at the baseline, hairline solid gridlines, clean ticks, selective labels (latest week
 * only), tap/focus tooltip on each column (hit area = the whole band), a table view, text in
 * text tokens. Bar colour = the goal colour stepped for contrast per mode (see .chart-bar in CSS;
 * validated ≥ 3:1 on both surfaces).
 */
export function WeeklyChart({ data, target, color }: { data: { weekStart: string; minutes: number }[]; target?: number; color: string }) {
  const [active, setActive] = useState<number | null>(null)
  const W = 640
  const H = 220
  const pad = { top: 20, right: 64, bottom: 28, left: 52 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const max = Math.max(60, target ?? 0, ...data.map((d) => d.minutes))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = (m: number) => pad.top + plotH - (m / top) * plotH
  const band = plotW / data.length
  const barW = Math.min(24, band * 0.6)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const last = data.length - 1
  const label = (w: string) => format(parseISO(w), 'd MMM')

  return (
    <figure className="chart" style={{ ['--goal' as string]: color }}>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Minutes per week, last ${data.length} weeks`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.left - 8} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
                {t === 0 ? '0' : formatDuration(t)}
              </text>
            </g>
          ))}
          {target !== undefined && target <= top && (
            <g>
              <line x1={pad.left} x2={W - pad.right} y1={y(target)} y2={y(target)} className="chart-target" />
              <text x={W - pad.right + 6} y={y(target)} className="chart-tick" dominantBaseline="middle">
                target {formatDuration(target)}
              </text>
            </g>
          )}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2
            const h = y(0) - y(d.minutes)
            return (
              <g key={d.weekStart}>
                {d.minutes > 0 && <path d={column(cx - barW / 2, y(0), barW, h)} className={active === i ? 'chart-bar active' : 'chart-bar'} />}
                {(i === last || i % 3 === 0) && (
                  <text x={cx} y={H - 8} className="chart-tick" textAnchor="middle">
                    {i === last ? 'this week' : label(d.weekStart)}
                  </text>
                )}
                {i === last && (
                  <text x={cx} y={y(d.minutes) - 6} className="chart-value" textAnchor="middle">
                    {formatDuration(d.minutes)}
                  </text>
                )}
                {/* hit target: the whole band, taller than the mark */}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  className="chart-hit"
                  tabIndex={0}
                  role="button"
                  aria-label={`Week of ${label(d.weekStart)}: ${formatDuration(d.minutes)}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                  // touch fires "leave" right after lifting the finger: only a mouse hides on leave
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                  onClick={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
        </svg>
        {active !== null && (
          <div
            className="chart-tip"
            style={{ left: `${((pad.left + band * active + band / 2) / W) * 100}%`, top: `${(Math.min(y(data[active]!.minutes), y(0) - 40) / H) * 100}%` }}
            role="status"
          >
            <strong>{formatDuration(data[active]!.minutes)}</strong>
            <span>week of {label(data[active]!.weekStart)}</span>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.weekStart}>
                <td>{format(parseISO(d.weekStart), 'EEE d MMM yyyy')}</td>
                <td>{formatDuration(d.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Clean tick spacing in minutes. */
function niceStep(max: number): number {
  for (const s of [15, 30, 60, 120, 180, 300, 600, 1200]) if (max / s <= 4) return s
  return 1800
}

/** A column with a 4px rounded top and a square base. */
function column(x: number, base: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  const t = base - h
  return `M${x},${base} V${t + r} Q${x},${t} ${x + r},${t} H${x + w - r} Q${x + w},${t} ${x + w},${t + r} V${base} Z`
}
