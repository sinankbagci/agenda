import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { HeatCell } from '../../domain/yearReview'
import { formatDuration } from '../../domain/time'

const LEVEL_TEXT = ['nothing', 'under 30 min', '30 min – 1 h', '1–2 h', '2 h or more']

/**
 * GitHub-style heatmap: one column per week (Mon at the top), colour = focused minutes.
 * Sequential blue ramp, validated on both surfaces (see .heat-l* in CSS); empty days are a
 * neutral hairline-grey. Tap / focus a day for its tooltip; "Less → More" legend; monthly table.
 */
export function YearHeatmap({ weeks, year }: { weeks: HeatCell[][]; year: number }) {
  const [active, setActive] = useState<HeatCell | null>(null)
  const cell = 12
  const gap = 3
  const left = 28
  const top = 18
  const W = left + weeks.length * (cell + gap) + 12
  const H = top + 7 * (cell + gap)
  // month labels above the first week that holds the 1st of a month
  const months = weeks.flatMap((w, i) => {
    const first = w.find((c) => c.date?.endsWith('-01'))
    return first ? [{ i, label: format(parseISO(first.date!), 'MMM') }] : []
  })
  const byMonth = Array.from({ length: 12 }, (_, m) => {
    const cells = weeks.flat().filter((c) => c.date && Number(c.date.slice(5, 7)) === m + 1)
    return { m, minutes: cells.reduce((a, c) => a + c.minutes, 0), days: cells.filter((c) => c.minutes > 0).length }
  })
  const pos = active ? weeks.findIndex((w) => w.includes(active)) : -1
  const row = active && pos >= 0 ? weeks[pos]!.indexOf(active) : 0

  return (
    <figure className="chart heatmap">
      <div className="chart-wrap heat-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 560 }} role="img" aria-label={`Focused time per day in ${year}`}>
          {months.map((m) => (
            <text key={m.i} x={left + m.i * (cell + gap)} y={10} className="chart-tick">
              {m.label}
            </text>
          ))}
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, r) =>
            d ? (
              <text key={r} x={0} y={top + r * (cell + gap) + cell / 2} dominantBaseline="middle" className="chart-tick">
                {d}
              </text>
            ) : null,
          )}
          {weeks.map((w, i) =>
            w.map((c, r) =>
              c.date ? (
                <rect
                  key={c.date}
                  x={left + i * (cell + gap)}
                  y={top + r * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2}
                  className={`heat-l${c.level}${active === c ? ' active' : ''}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${format(parseISO(c.date), 'EEE d MMM')}: ${c.minutes ? formatDuration(c.minutes) : 'nothing'}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(c)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
                  onClick={() => setActive(c)}
                  onFocus={() => setActive(c)}
                  onBlur={() => setActive(null)}
                />
              ) : null,
            ),
          )}
        </svg>
        {active?.date && (
          <div
            className="chart-tip"
            style={{ left: `${((left + pos * (cell + gap) + cell / 2) / W) * 100}%`, top: `${((top + row * (cell + gap)) / H) * 100}%` }}
            role="status"
          >
            <strong>{active.minutes ? formatDuration(active.minutes) : 'Nothing logged'}</strong>
            <span>{format(parseISO(active.date), 'EEE d MMM')}</span>
          </div>
        )}
      </div>
      <div className="heat-legend" aria-label="Colour scale">
        <span className="muted small">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-swatch heat-l${l}`} title={LEVEL_TEXT[l]} aria-label={LEVEL_TEXT[l]} />
        ))}
        <span className="muted small">More</span>
        <span className="muted small heat-legend-note">· under 30 min · 30 min · 1 h · 2 h+</span>
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Time</th>
              <th scope="col">Active days</th>
            </tr>
          </thead>
          <tbody>
            {byMonth.map((r) => (
              <tr key={r.m}>
                <td>{format(new Date(year, r.m, 1), 'MMMM')}</td>
                <td>{r.minutes ? formatDuration(r.minutes) : '—'}</td>
                <td>{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
