import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import { groupByDay, logTypeIcon } from '../../domain/log'
import { formatDuration } from '../../domain/time'
import { useNow } from '../../ui/useNow'
import { CheckInCard } from './CheckInCard'
import { LogEntryForm } from './LogEntryForm'

const PAGE_DAYS = 60

/** /log — activity log (SPEC 4.3) and evening check-ins (4.1c). */
export function LogScreen() {
  const today = format(useNow(), 'yyyy-MM-dd')
  const [days, setDays] = useState(PAGE_DAYS)
  const since = format(addDays(parseISO(today), -days), 'yyyy-MM-dd')
  const data = useLiveQuery(async () => {
    const [entries, checkIns, goals, todayCheckIn] = await Promise.all([
      repos.logEntries.byRange(since, today),
      repos.checkIns.byRange(since, today),
      repos.goals.all(),
      repos.checkIns.get(today),
    ])
    return { entries, checkIns, goals, todayCheckIn }
  }, [since, today])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingCheckIn, setEditingCheckIn] = useState(false)
  if (!data) return null
  const grouped = groupByDay(data.entries, data.checkIns)
  const goalName = (id?: string) => data.goals.find((g) => g.id === id)?.name

  return (
    <section className="screen log-screen">
      <div className="screen-head">
        <h1>Log</h1>
        {!adding && (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Add entry
          </button>
        )}
      </div>
      <p className="muted intro">Things you did outside the plan — “watched X”, “read 40 pages”, “went for a run”. Link one to a goal and it counts toward it.</p>
      {adding && <LogEntryForm today={today} onDone={() => setAdding(false)} />}

      <h2>Today’s check-in</h2>
      {data.todayCheckIn && !editingCheckIn ? (
        <button type="button" className="card checkin-summary" onClick={() => setEditingCheckIn(true)}>
          Energy <strong>{data.todayCheckIn.energy}/5</strong> · Mood <strong>{data.todayCheckIn.mood}/5</strong>
          {data.todayCheckIn.note ? <span className="muted"> · {data.todayCheckIn.note}</span> : null}
          <span className="muted small"> — tap to change</span>
        </button>
      ) : (
        <CheckInCard key={data.todayCheckIn ? 'edit' : 'new'} date={today} existing={data.todayCheckIn} onSaved={() => setEditingCheckIn(false)} />
      )}

      <h2>History</h2>
      {grouped.length === 0 && <p className="muted">Nothing logged yet.</p>}
      {grouped.map((day) => (
        <div key={day.date} className="log-day">
          <div className="log-day-head">
            <strong>{day.date === today ? 'Today' : format(parseISO(day.date), 'EEEE d MMMM')}</strong>
            {day.minutes > 0 && <span className="muted">{formatDuration(day.minutes)}</span>}
            {day.checkIn && (
              <span className="muted small">
                · energy {day.checkIn.energy}/5 · mood {day.checkIn.mood}/5{day.checkIn.note ? ` · “${day.checkIn.note}”` : ''}
              </span>
            )}
          </div>
          {day.entries.length > 0 && (
            <div className="list">
              {day.entries.map((e) =>
                editing === e.id ? (
                  <div key={e.id} className="list-item editing">
                    <LogEntryForm today={today} entry={e} onDone={() => setEditing(null)} />
                  </div>
                ) : (
                  <button key={e.id} type="button" className="list-item" onClick={() => setEditing(e.id)}>
                    <span className="log-icon" aria-hidden>
                      {logTypeIcon(e.type)}
                    </span>
                    <span className="row-main">
                      <strong>{e.title}</strong>
                      <span className="muted">
                        {[e.minutes ? formatDuration(e.minutes) : '', e.amount ? `${e.amount} ${e.type === 'read' ? 'pages' : ''}`.trim() : ''].filter(Boolean).join(' · ')}
                      </span>
                      {e.goalId && goalName(e.goalId) && <span className="badge">→ {goalName(e.goalId)}</span>}
                      {e.note && <span className="log-note">{e.note}</span>}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setDays(days + PAGE_DAYS)}>
        Show older
      </button>
    </section>
  )
}
