import { useState } from 'react'
import { format } from 'date-fns'

type Row = { month: number; energy?: number; mood?: number; count: number }

/**
 * Average energy & mood by month (two series, scale 1–5): lines with dots, gaps where a month
 * has no check-ins, legend, tap/focus tooltip per month, table view. Series colours validated
 * per mode (.mood-energy / .mood-mood in CSS); text stays in text tokens.
 */
export function MoodChart({ data, year }: { data: Row[]; year: number }) {
  const [active, setActive] = useState<number | null>(null)
  const W = 640
  const H = 200
  const pad = { top: 16, right: 16, bottom: 28, left: 32 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const band = plotW / 12
  const x = (i: number) => pad.left + band * i + band / 2
  const y = (v: number) => pad.top + plotH - ((v - 1) / 4) * plotH
  const month = (i: number, f = 'MMM') => format(new Date(year, i, 1), f)

  const path = (k: 'energy' | 'mood') => {
    let d = ''
    let pen = false
    data.forEach((r, i) => {
      const v = r[k]
      if (v === undefined) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `
      pen = true
    })
    return d
  }
  const a = active !== null ? data[active] : undefined

  return (
    <figure className="chart">
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-dot mood-energy" aria-hidden /> Energy
        </span>
        <span className="legend-item">
          <span className="legend-dot mood-mood" aria-hidden /> Mood
        </span>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average energy and mood per month in ${year}`}>
          {[1, 2, 3, 4, 5].map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.left - 8} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {data.map((_, i) => (
            <text key={i} x={x(i)} y={H - 8} className="chart-tick" textAnchor="middle">
              {month(i).slice(0, 3)}
            </text>
          ))}
          {(['energy', 'mood'] as const).map((k) => (
            <g key={k} className={`mood-${k}`}>
              <path d={path(k)} className="mood-line" />
              {data.map((r, i) => (r[k] !== undefined ? <circle key={i} cx={x(i)} cy={y(r[k]!)} r={active === i ? 5 : 3.5} className="mood-dot" /> : null))}
            </g>
          ))}
          {data.map((r, i) => (
            <rect
              key={i}
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={plotH}
              className="chart-hit"
              tabIndex={0}
              role="button"
              aria-label={`${month(i, 'MMMM')}: ${r.count ? `energy ${r.energy}, mood ${r.mood}` : 'no check-ins'}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
              onClick={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        {a && active !== null && (
          <div className="chart-tip" style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(Math.max(a.energy ?? 3, a.mood ?? 3)) / H) * 100}%` }} role="status">
            <strong>{month(active, 'MMMM')}</strong>
            <span>{a.count ? `Energy ${a.energy} · Mood ${a.mood} · ${a.count} check-in${a.count === 1 ? '' : 's'}` : 'No check-ins'}</span>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Energy</th>
              <th scope="col">Mood</th>
              <th scope="col">Check-ins</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i}>
                <td>{month(i, 'MMMM')}</td>
                <td>{r.energy ?? '—'}</td>
                <td>{r.mood ?? '—'}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
