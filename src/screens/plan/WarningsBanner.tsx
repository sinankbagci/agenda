import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import type { PlanWarning } from '../../domain/planner'

const key = (w: PlanWarning) => `${w.kind}|${w.message}`

/** Planning problems from the last re-plan, with the concrete options the planner suggests. */
export function WarningsBanner() {
  const data = useLiveQuery(async () => {
    const [w, d] = await Promise.all([db.meta.get('planWarnings'), db.meta.get('dismissedWarnings')])
    return {
      warnings: w ? (JSON.parse(w.value) as PlanWarning[]) : [],
      dismissed: new Set<string>(d ? (JSON.parse(d.value) as string[]) : []),
    }
  }, [])
  const [open, setOpen] = useState<boolean | null>(null)
  if (!data) return null
  const visible = data.warnings.filter((w) => !data.dismissed.has(key(w)))
  if (!visible.length) return null

  const serious = visible.some((w) => w.kind === 'deadlineShortfall' || w.kind === 'reviewNotPlaced')
  const expanded = open ?? serious

  const dismiss = async (w: PlanWarning) => {
    const next = [...data.dismissed, key(w)]
    await db.meta.put({ key: 'dismissedWarnings', value: JSON.stringify(next) })
  }

  return (
    <section className={serious ? 'warnings serious' : 'warnings'} aria-label="Planning issues">
      <button type="button" className="warnings-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span>
          ⚠︎ {visible.length} planning issue{visible.length === 1 ? '' : 's'}
        </span>
        <span aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <ul className="warnings-list">
          {visible.map((w) => (
            <li key={key(w)}>
              <p>{w.message}</p>
              <div className="warning-actions">
                <Actions w={w} />
                <button type="button" className="btn small link" onClick={() => dismiss(w)}>
                  {w.kind === 'deadlineShortfall' ? 'Accept shortfall' : 'Dismiss'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Actions({ w }: { w: PlanWarning }) {
  switch (w.kind) {
    case 'deadlineShortfall':
      return (
        <>
          {w.options.map((o) => {
            switch (o.kind) {
              case 'addFreeTime':
                return (
                  <Link key={o.kind} to="/settings/availability" className="btn small">
                    Add free time before {format(parseISO(o.before), 'd MMM')}
                  </Link>
                )
              case 'reduceHours':
                return o.toHours > 0 ? (
                  <button
                    key={o.kind}
                    type="button"
                    className="btn small"
                    onClick={() => {
                      if (window.confirm(`Reduce the goal to ${o.toHours}h? It will be re-planned.`)) void repos.goals.update(w.goalId, { totalHours: o.toHours })
                    }}
                  >
                    Reduce to {o.toHours}h
                  </button>
                ) : null
              case 'pauseGoal':
                return (
                  <Link key={o.kind} to={`/goals/${o.goalId}`} className="btn small">
                    Pause or lower “{o.name}”
                  </Link>
                )
              case 'acceptShortfall':
                return null // the dismiss button says "Accept shortfall"
            }
          })}
        </>
      )
    case 'reviewNotPlaced':
    case 'recurringShortfall':
    case 'ongoingShortfall':
      return (
        <>
          <Link to={`/goals/${w.goalId}`} className="btn small">
            Adjust goal
          </Link>
          <Link to="/settings/availability" className="btn small">
            Add free time
          </Link>
        </>
      )
    case 'goalTravelUnknown':
      return (
        <Link to="/settings/locations" className="btn small">
          Set travel times
        </Link>
      )
    case 'setup':
      return (
        <Link to="/settings" className="btn small">
          Check setup
        </Link>
      )
  }
}
