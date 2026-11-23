import { Link } from 'react-router-dom'
import type { TimelineItem } from '../../domain/agenda'
import { fromMinutes } from '../../domain/time'

const STATUS_LABEL = { done: 'Done', partial: 'Partly done', skipped: 'Skipped' } as const

export function Timeline({ items, current, next }: { items: TimelineItem[]; current?: string; next?: string }) {
  return (
    <ol className="timeline">
      {items.map((i) => {
        const highlight = i.id === current ? 'now' : i.id === next ? 'next' : undefined
        const body = (
          <>
            <span className="tl-time">
              <span>{fromMinutes(i.start)}</span>
              <span className="muted">{fromMinutes(i.end)}</span>
            </span>
            <span className="tl-bar" style={i.color ? { background: i.color } : undefined} aria-hidden />
            <span className="tl-main">
              <span className="tl-title">
                {i.locked && (
                  <span className="lock" aria-label="Locked">
                    🔒{' '}
                  </span>
                )}
                {i.icon && <span aria-hidden>{i.icon} </span>}
                {i.title}
              </span>
              <span className="muted tl-sub">{i.subtitle}</span>
            </span>
            <span className="tl-badges">
              {highlight === 'now' && <span className="badge now">Now</span>}
              {highlight === 'next' && <span className="badge next">Next</span>}
              {i.status && i.status !== 'planned' && <span className={`badge st-${i.status}`}>{STATUS_LABEL[i.status]}</span>}
            </span>
          </>
        )
        const cls = `tl-item kind-${i.kind}${highlight ? ` hl-${highlight}` : ''}${i.status && i.status !== 'planned' ? ` st-${i.status}` : ''}`
        return (
          <li key={i.id} className={cls}>
            {i.goalId ? (
              <Link to={`/goals/${i.goalId}`} className="tl-link">
                {body}
              </Link>
            ) : (
              <div className="tl-link">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
