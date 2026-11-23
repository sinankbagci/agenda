import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import { dayProgress, dayTimeline, nowAndNext } from '../../domain/agenda'
import { useNow } from '../../ui/useNow'
import { ProgressRing } from './ProgressRing'
import { Timeline } from './Timeline'
import { usePlanData } from './usePlanData'
import { WarningsBanner } from './WarningsBanner'
import { SessionSheet, type SheetMode } from './SessionSheet'
import { AddToDaySheet } from './AddToDaySheet'
import { complete, partial, skip, undo, withNote } from '../../domain/sessions'
import type { Session } from '../../db/types'
import { enqueueReplan } from '../../app/usePlanKeeper'
import { playChime } from '../../ui/feedback'
import { useSettings } from '../../ui/form'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** /today and /day/:date — the timeline of one day. */
export function DayScreen() {
  const params = useParams()
  const navigate = useNavigate()
  const now = useNow()
  const today = format(now, 'yyyy-MM-dd')
  const date = params.date && ISO_RE.test(params.date) ? params.date : today
  const isToday = date === today
  const data = usePlanData(date, date)
  const goalCount = useLiveQuery(() => repos.goals.active().then((g) => g.length), [])
  // sessions with notes, for "last time: …" (small: only noted sessions)
  const noted = useLiveQuery(() => repos.sessions.all().then((all) => all.filter((x) => x.note)), [], [])
  const settings = useSettings()
  const [sheet, setSheet] = useState<{ id: string; mode: SheetMode } | null>(null)
  const [celebrating, setCelebrating] = useState<string>()
  const [replanning, setReplanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

  const shift = (n: number) => {
    const d = format(addDays(parseISO(date), n), 'yyyy-MM-dd')
    navigate(d === today ? '/today' : `/day/${d}`)
  }

  const items = data ? dayTimeline(date, data) : []
  const { current, next } = isToday ? nowAndNext(items, now.getHours() * 60 + now.getMinutes()) : {}
  const progress = dayProgress(data?.sessions ?? [])
  const byId = new Map((data?.sessions ?? []).map((x) => [x.id, x]))

  // Every status change re-plans (skipped / unfinished minutes go back to the goal); today stays frozen.
  const save = async (next: Session) => {
    await repos.sessions.put(next)
    void enqueueReplan()
  }
  const celebrate = (id: string) => {
    if (settings?.completionSound) playChime() // inside the tap: iOS only allows audio from a gesture
    setCelebrating(id)
    later(() => setCelebrating(undefined), 1000)
  }
  const handlers = {
    onOpen: (id: string) => setSheet({ id, mode: 'actions' as const }),
    onPart: (id: string) => setSheet({ id, mode: 'part' as const }),
    onComplete: (id: string) => {
      const x = byId.get(id)
      if (!x) return
      celebrate(id)
      setSheet(null)
      void save(complete(x))
      later(() => setSheet({ id, mode: 'note' }), 900)
    },
    onSkip: (id: string) => {
      const x = byId.get(id)
      if (x) void save(skip(x))
      setSheet(null)
    },
    onUndo: (id: string) => {
      const x = byId.get(id)
      if (x) void save(undo(x))
    },
  }
  const sheetSession = sheet ? byId.get(sheet.id) : undefined

  const replanToday = async () => {
    if (!window.confirm('Re-plan the rest of today? Sessions that are done, skipped or already started stay as they are.')) return
    setReplanning(true)
    await enqueueReplan({ includeToday: true })
    setReplanning(false)
  }

  return (
    <section className="screen day-screen">
      <div className="screen-head">
        <div>
          <h1>{isToday ? 'Today' : format(parseISO(date), 'EEEE')}</h1>
          <p className="muted head-sub">{format(parseISO(date), 'EEEE d MMMM yyyy')}</p>
        </div>
        <div className="pager">
          {date >= today && (
            <button type="button" className="btn primary add-btn" onClick={() => setAdding(true)}>
              + Add
            </button>
          )}
          <button type="button" className="btn" aria-label="Previous day" onClick={() => shift(-1)}>
            ‹
          </button>
          {!isToday && (
            <Link to="/today" className="btn">
              Today
            </Link>
          )}
          <button type="button" className="btn" aria-label="Next day" onClick={() => shift(1)}>
            ›
          </button>
        </div>
      </div>

      {isToday && <WarningsBanner />}

      {data && progress.total > 0 && (
        <div className="card ring-card">
          <ProgressRing progress={progress} />
        </div>
      )}

      {data && goalCount === 0 && (
        <div className="card empty-state">
          <p>
            <strong>No goals yet.</strong>
          </p>
          <p className="muted">Add a goal and the planner fits it into your free time.</p>
          <Link to="/goals/new" className="btn primary">
            Add a goal
          </Link>
        </div>
      )}

      {data && items.length === 0 && goalCount !== 0 && <p className="muted">Nothing planned for this day.</p>}
      {data && items.length > 0 && (
        <Timeline
          items={items}
          current={current}
          next={next}
          today={today}
          sessions={byId}
          allSessions={noted}
          celebrating={celebrating}
          handlers={handlers}
        />
      )}

      {isToday && data && goalCount !== 0 && (
        <div className="replan-row">
          <button type="button" className="btn" onClick={replanToday} disabled={replanning}>
            {replanning ? 'Re-planning…' : '↻ Re-plan the rest of today'}
          </button>
          <span className="muted small">Today stays as planned unless you do this.</span>
        </div>
      )}

      {adding && (
        <AddToDaySheet
          date={date}
          today={today}
          onClose={() => setAdding(false)}
          onSaved={(d) => {
            setAdding(false)
            if (d !== date) navigate(d === today ? '/today' : `/day/${d}`)
          }}
        />
      )}

      {sheet && sheetSession && data && (
        <SessionSheet
          key={`${sheet.id}-${sheet.mode}`}
          session={sheetSession}
          goal={data.goals.find((g) => g.id === sheetSession.goalId)}
          allSessions={noted}
          today={today}
          mode={sheet.mode}
          onClose={() => setSheet(null)}
          onComplete={() => handlers.onComplete(sheet.id)}
          onPartial={(m) => {
            const next = partial(sheetSession, m)
            if (next.status === 'done') celebrate(sheet.id)
            void save(next)
            setSheet({ id: sheet.id, mode: 'note' })
          }}
          onSkip={() => handlers.onSkip(sheet.id)}
          onUndo={() => {
            handlers.onUndo(sheet.id)
            setSheet(null)
          }}
          onNote={(note) => void repos.sessions.put(withNote(sheetSession, note))}
          onRemove={async () => {
            await repos.sessions.remove(sheetSession.id)
            setSheet(null)
            void enqueueReplan(sheetSession.date === today ? { includeToday: true } : undefined)
          }}
        />
      )}
    </section>
  )
}
