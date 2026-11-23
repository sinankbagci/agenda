import type { TimelineItem } from '../../domain/agenda'
import type { Session } from '../../db/types'
import { canComplete, canSkip, isMissed, lastNoteBefore } from '../../domain/sessions'
import { fromMinutes } from '../../domain/time'
import { Burst } from '../../ui/feedback'
import { SwipeRow } from './SwipeRow'

const STATUS_LABEL = { done: 'Done', partial: 'Partly done', skipped: 'Skipped' } as const

export interface TimelineHandlers {
  onOpen: (sessionId: string) => void
  onComplete: (sessionId: string) => void
  onPart: (sessionId: string) => void
  onSkip: (sessionId: string) => void
  onUndo: (sessionId: string) => void
  /** Tap on a fixed-program block (one-off events can be edited / deleted from the day). */
  onOpenFixed?: (blockId: string) => void
}

export function Timeline({
  items,
  current,
  next,
  today,
  sessions,
  allSessions,
  celebrating,
  handlers,
}: {
  items: TimelineItem[]
  current?: string
  next?: string
  today: string
  /** Sessions of this day by id. */
  sessions: Map<string, Session>
  /** For "last note" lookups. */
  allSessions: readonly Session[]
  celebrating?: string
  handlers: TimelineHandlers
}) {
  return (
    <ol className="timeline">
      {items.map((i) => {
        const session = sessions.get(i.id)
        const work = session && (session.kind === 'goal' || session.kind === 'review')
        const highlight = i.id === current ? 'now' : i.id === next ? 'next' : undefined
        const missed = session ? isMissed(session, today) : false
        const cls = `tl-item kind-${i.kind}${highlight ? ` hl-${highlight}` : ''}${i.status && i.status !== 'planned' ? ` st-${i.status}` : ''}${missed ? ' st-missed' : ''}${celebrating === i.id ? ' celebrate' : ''}`

        const main = (
          <>
            <span className="tl-time">
              <span>{fromMinutes(i.start)}</span>
              <span className="muted">{fromMinutes(i.end)}</span>
            </span>
            <span className="tl-bar" style={i.color ? { background: i.color } : undefined} aria-hidden />
            <span className="tl-main">
              <span className="tl-title">
                {i.locked && <span aria-label="Locked">🔒 </span>}
                {i.icon && <span aria-hidden>{i.icon} </span>}
                {i.title}
              </span>
              <span className="muted tl-sub">
                {i.subtitle}
                {session?.actualMinutes !== undefined && session.status === 'partial' && ` · did ${session.actualMinutes}m`}
              </span>
              {work && session.status === 'planned' && <LastNote session={session} all={allSessions} />}
              {work && session.note && session.status !== 'planned' && <span className="tl-note">📝 {session.note}</span>}
            </span>
            <span className="tl-badges">
              {session?.pinned && (
                <span className="badge pinned" title="Added by you">
                  📌
                </span>
              )}
              {highlight === 'now' && <span className="badge now">Now</span>}
              {highlight === 'next' && <span className="badge next">Next</span>}
              {missed && <span className="badge st-missed">Missed</span>}
              {i.status && i.status !== 'planned' && <span className={`badge st-${i.status}`}>{STATUS_LABEL[i.status]}</span>}
            </span>
          </>
        )

        if (i.kind === 'fixed' && handlers.onOpenFixed) {
          return (
            <li key={i.id} className={cls}>
              <button type="button" className="tl-link tl-fixed-btn" onClick={() => handlers.onOpenFixed!(i.id.replace(/^fixed:/, ''))}>
                {main}
              </button>
            </li>
          )
        }
        if (!work || !session) {
          return (
            <li key={i.id} className={cls}>
              <div className="tl-link">{main}</div>
            </li>
          )
        }

        const completable = canComplete(session, today)
        const done = session.status === 'done'
        return (
          <li key={i.id} className={cls} style={{ ['--goal' as string]: i.color }}>
            <SwipeRow
              onSwipeRight={completable && !done ? () => handlers.onComplete(i.id) : undefined}
              actions={
                session.status === 'planned' ? (
                  <>
                    {completable && (
                      <button type="button" className="swipe-btn part" onClick={() => handlers.onPart(i.id)}>
                        Part
                      </button>
                    )}
                    {canSkip(session) && (
                      <button type="button" className="swipe-btn skip" onClick={() => handlers.onSkip(i.id)}>
                        Skip
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className="swipe-btn undo" onClick={() => handlers.onUndo(i.id)}>
                    Undo
                  </button>
                )
              }
            >
              <div className="tl-link tl-work">
                {completable ? (
                  <button
                    type="button"
                    className={done ? 'check on' : 'check'}
                    aria-label={done ? `Done: ${i.title}. Tap to undo` : `Mark ${i.title} done`}
                    aria-pressed={done}
                    onClick={() => (done ? handlers.onUndo(i.id) : handlers.onComplete(i.id))}
                  >
                    <span aria-hidden>✓</span>
                    {celebrating === i.id && <Burst color={i.color ?? 'var(--accent)'} />}
                  </button>
                ) : (
                  <span className="check placeholder" aria-hidden />
                )}
                <button type="button" className="tl-open" onClick={() => handlers.onOpen(i.id)} aria-label={`Open ${i.title}`}>
                  {main}
                </button>
              </div>
            </SwipeRow>
          </li>
        )
      })}
    </ol>
  )
}

function LastNote({ session, all }: { session: Session; all: readonly Session[] }) {
  const last = lastNoteBefore(session, all)
  if (!last) return null
  return <span className="tl-note">Last time: {last.note}</span>
}
