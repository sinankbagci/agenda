import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, parseISO } from 'date-fns'
import { repos } from '../../db/repositories'
import type { Energy, Goal } from '../../db/types'
import {
  eventToFixedBlock,
  extraTimeOverrides,
  overlapWarnings,
  pinnedSession,
  validateEvent,
  validateExtraTime,
  validateGoalSession,
  validateTask,
  taskToGoal,
  type TaskDraft,
  type EventDraft,
  type ExtraTimeDraft,
  type GoalSessionDraft,
} from '../../domain/oneOff'
import type { Check } from '../../domain/setupValidation'
import { fromMinutes, toMinutes, isTime } from '../../domain/time'
import { enqueueReplan } from '../../app/usePlanKeeper'
import { DateInput, Field, LocationSelect, NumberInput, Problems, Segmented, TextInput, TimeInput, hasErrors } from '../../ui/form'
import { GoalChips, boostableGoals } from '../../ui/GoalChips'
import { CATEGORIES, COLORS } from '../../domain/goals'
import { formatDuration } from '../../domain/time'

type Tab = 'task' | 'event' | 'session' | 'extra'

const TABS = [
  { value: 'task', label: 'Task' },
  { value: 'event', label: 'Event' },
  { value: 'session', label: 'Goal session' },
  { value: 'extra', label: 'Extra free time' },
] as const

const ENERGY = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const

const plus = (t: string, min: number) => (isTime(t) ? fromMinutes(Math.min(toMinutes(t) + min, 23 * 60 + 59)) : t)
const nextDay = (d: string) => format(addDays(parseISO(d), 1), 'yyyy-MM-dd')

/**
 * "+ Add" on a day: a one-off event (locked), a goal session at a chosen time (pinned),
 * or extra free time over some days with optional "use it for" goals. Saving re-plans;
 * if it touches today, today is re-planned too (the user asked for it explicitly).
 */
export function AddToDaySheet({ date, today, onClose, onSaved }: { date: string; today: string; onClose: () => void; onSaved: (date: string) => void }) {
  const [tab, setTab] = useState<Tab>('task')
  const [tried, setTried] = useState(false)
  const goals = useLiveQuery(() => repos.goals.all(), [], [] as Goal[])
  const fixedBlocks = useLiveQuery(() => repos.fixedBlocks.all(), [], [])

  const [event, setEvent] = useState<EventDraft>({ title: '', date, start: '13:00', end: '15:00' })
  const [task, setTask] = useState<TaskDraft>({ title: '', minutes: 60, doBy: date, category: 'Study', focus: 'demanding' })
  const [session, setSession] = useState<GoalSessionDraft>({ goalId: '', date, start: '10:00', end: '11:00' })
  const weekendStart = parseISO(date).getDay() === 6
  const [extra, setExtra] = useState<ExtraTimeDraft>({
    from: date,
    to: weekendStart ? nextDay(date) : date,
    start: '10:00',
    end: '18:00',
    energy: 'normal',
    boostGoalIds: [],
  })

  const checkDate = tab === 'task' ? task.doBy : tab === 'event' ? event.date : tab === 'session' ? session.date : extra.from
  const daySessions = useLiveQuery(() => repos.sessions.byDate(checkDate), [checkDate], [])

  const activeFirst = [...goals].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  let check: Check
  if (tab === 'task') {
    check = validateTask(task, today)
  } else if (tab === 'event') {
    check = validateEvent(event, today)
    check.warnings.push(...overlapWarnings(event.date, event.start, event.end, fixedBlocks, daySessions, goals))
  } else if (tab === 'session') {
    check = validateGoalSession(session, goals, today)
    check.warnings.push(...overlapWarnings(session.date, session.start, session.end, fixedBlocks, daySessions, goals))
  } else {
    check = validateExtraTime(extra, today)
  }

  async function save() {
    setTried(true)
    if (hasErrors(check)) return
    let first = date
    let touchesToday = false
    if (tab === 'task') {
      const color = COLORS[goals.length % COLORS.length]!
      await repos.goals.add(taskToGoal(task, color, Date.now()))
      first = date
      touchesToday = true // it may well need time today
    } else if (tab === 'event') {
      await repos.fixedBlocks.add(eventToFixedBlock(event))
      first = event.date
      touchesToday = event.date === today
    } else if (tab === 'session') {
      const goal = goals.find((g) => g.id === session.goalId)!
      await repos.sessions.put(pinnedSession(session, goal, `pin:${crypto.randomUUID()}`))
      first = session.date
      touchesToday = session.date === today
    } else {
      const groupId = crypto.randomUUID() // the days are listed and edited as one entry
      for (const o of extraTimeOverrides(extra, groupId)) await repos.availabilityOverrides.add(o)
      first = extra.from
      touchesToday = extra.from <= today && today <= extra.to
    }
    void enqueueReplan(touchesToday ? { includeToday: true } : undefined)
    onSaved(first)
  }

  const shown = tried ? check : { errors: [], warnings: check.warnings }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet add-sheet" role="dialog" aria-modal="true" aria-label="Add to a day" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <h2 className="sheet-title">Add</h2>
        <Segmented
          value={tab}
          options={TABS}
          onChange={(t) => {
            setTab(t)
            setTried(false)
          }}
        />

        {tab === 'task' && (
          <>
            <p className="muted">A one-off thing to get done, like homework. It’s planned before your “do it by” day; tick it off when it’s finished.</p>
            <div className="form-grid">
              <Field label="What">
                <TextInput value={task.title} placeholder="Analysis homework" onChange={(title) => setTask({ ...task, title })} />
              </Field>
              <Field label="How long" hint={Number.isFinite(task.minutes) && task.minutes > 0 ? formatDuration(task.minutes) : undefined}>
                <NumberInput value={task.minutes} min={10} step={15} suffix="min" onChange={(minutes) => setTask({ ...task, minutes })} />
              </Field>
              <Field label="Do it by" hint="The last day you can work on it.">
                <DateInput value={task.doBy} onChange={(doBy) => setTask({ ...task, doBy })} />
              </Field>
              <Field label="Category">
                <select className="input" value={task.category} onChange={(e) => setTask({ ...task, category: e.target.value as TaskDraft['category'] })}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Focus" group>
              <Segmented
                value={task.focus}
                options={[
                  { value: 'demanding', label: 'Demanding' },
                  { value: 'light', label: 'Light' },
                ]}
                onChange={(focus) => setTask({ ...task, focus })}
              />
            </Field>
          </>
        )}

        {tab === 'event' && (
          <>
            <p className="muted">Something at a fixed time, like tennis or a dentist visit. Your plan moves around it.</p>
            <div className="form-grid">
              <Field label="What">
                <TextInput value={event.title} placeholder="Tennis" onChange={(title) => setEvent({ ...event, title })} />
              </Field>
              <Field label="Day">
                <DateInput value={event.date} onChange={(d) => setEvent({ ...event, date: d })} />
              </Field>
              <Field label="From">
                <TimeInput value={event.start} onChange={(start) => setEvent({ ...event, start, end: plus(start, toMinutes(event.end) - toMinutes(event.start)) })} />
              </Field>
              <Field label="Until">
                <TimeInput value={event.end} onChange={(end) => setEvent({ ...event, end })} />
              </Field>
              <Field label="Place (optional)" hint="Travel there and back is added.">
                <LocationSelect value={event.locationId} emptyLabel="Where I already am" onChange={(locationId) => setEvent({ ...event, locationId })} />
              </Field>
            </div>
          </>
        )}

        {tab === 'session' && (
          <>
            <p className="muted">Work on one of your goals at a time you choose. It counts toward the goal and you can tick it off.</p>
            <div className="form-grid">
              <Field label="Goal">
                <select
                  className="input"
                  value={session.goalId}
                  onChange={(e) => {
                    const g = goals.find((x) => x.id === e.target.value)
                    const len = g ? (g.type === 'recurring' ? g.sessionLength ?? g.maxSession : g.maxSession) : 60
                    setSession({ ...session, goalId: e.target.value, end: plus(session.start, len) })
                  }}
                >
                  <option value="">Choose…</option>
                  {activeFirst.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.active ? '' : ' (paused)'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day">
                <DateInput value={session.date} onChange={(d) => setSession({ ...session, date: d })} />
              </Field>
              <Field label="From">
                <TimeInput
                  value={session.start}
                  onChange={(start) => setSession({ ...session, start, end: plus(start, toMinutes(session.end) - toMinutes(session.start)) })}
                />
              </Field>
              <Field label="Until">
                <TimeInput value={session.end} onChange={(end) => setSession({ ...session, end })} />
              </Field>
            </div>
          </>
        )}

        {tab === 'extra' && (
          <>
            <p className="muted">More time than usual, e.g. “I’m home all weekend”. The plan uses it, and the other days get lighter.</p>
            <div className="form-grid">
              <Field label="From day">
                <DateInput value={extra.from} onChange={(from) => setExtra({ ...extra, from, to: extra.to < from ? from : extra.to })} />
              </Field>
              <Field label="To day">
                <DateInput value={extra.to} onChange={(to) => setExtra({ ...extra, to })} />
              </Field>
              <Field label="Each day from">
                <TimeInput value={extra.start} onChange={(start) => setExtra({ ...extra, start })} />
              </Field>
              <Field label="Until">
                <TimeInput value={extra.end} onChange={(end) => setExtra({ ...extra, end })} />
              </Field>
            </div>
            <Field label="Energy" group>
              <Segmented<Energy> value={extra.energy} options={ENERGY} onChange={(energy) => setExtra({ ...extra, energy })} />
            </Field>
            <Field
              group
              label="Use it for (optional)"
              hint="Chosen goals get this time first: deadlines move work here, reading and other ongoing goals can go beyond their usual target. Daily limits still apply."
            >
              <GoalChips goals={boostableGoals(goals)} value={extra.boostGoalIds} onChange={(boostGoalIds) => setExtra({ ...extra, boostGoalIds })} />
            </Field>
          </>
        )}

        <Problems check={shown} />
        <div className="button-row sheet-footer">
          <button type="button" className="btn primary" onClick={save}>
            Add
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
