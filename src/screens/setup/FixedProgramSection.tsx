import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { FixedBlock, FixedRule } from '../../db/types'
import { formatWeekdays, toMinutes } from '../../domain/time'

const day = (iso: string) => format(new Date(`${iso}T00:00`), 'd MMM yyyy')

export function describeFixedRule(rule: FixedRule): string {
  if (rule.kind === 'once') return format(new Date(`${rule.date}T00:00`), 'EEE d MMM yyyy')
  let s = formatWeekdays(rule.weekdays)
  if (rule.from && rule.until) s += `, ${day(rule.from)} – ${day(rule.until)}`
  else if (rule.from) s += `, from ${day(rule.from)}`
  else if (rule.until) s += `, until ${day(rule.until)}`
  return s
}

/** Weekly blocks first (by time), then one-offs by date. */
const order = (a: FixedBlock, b: FixedBlock) => {
  if (a.rule.kind !== b.rule.kind) return a.rule.kind === 'weekly' ? -1 : 1
  if (a.rule.kind === 'once' && b.rule.kind === 'once' && a.rule.date !== b.rule.date) return a.rule.date.localeCompare(b.rule.date)
  return toMinutes(a.start) - toMinutes(b.start)
}

export function FixedProgramSection({ editBase = '/settings/fixed' }: { editBase?: string }) {
  const blocks = useLiveQuery(() => repos.fixedBlocks.all(), [])
  const locations = useLiveQuery(() => repos.locations.all(), [], [])
  if (!blocks) return null
  const locName = (id?: string) => locations.find((l) => l.id === id)?.name
  return (
    <div className="list">
      {blocks.length === 0 && (
        <p className="muted list-empty">
          Nothing yet. Add classes, work and other commitments — the planner works around them and never moves them.
        </p>
      )}
      {[...blocks].sort(order).map((b) => (
        <Link key={b.id} to={`${editBase}/${b.id}`} className="list-item">
          <span className="lock" aria-label="Locked">
            🔒
          </span>
          <span className="row-main">
            <strong>{b.title}</strong>
            <span className="muted">
              {b.start}–{b.end} · {describeFixedRule(b.rule)}
              {locName(b.locationId) && ` · ${locName(b.locationId)}`}
            </span>
          </span>
          <span className="chevron" aria-hidden>
            ›
          </span>
        </Link>
      ))}
      <Link to={`${editBase}/new`} className="list-add">
        + Add fixed block
      </Link>
    </div>
  )
}
