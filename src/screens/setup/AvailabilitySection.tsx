import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { AvailabilityOverride, AvailabilityWindow, Energy, Weekday } from '../../db/types'
import {
  findOverlappingWindows,
  validateOverride,
  validateWindow,
  weeklyAvailableMinutes,
} from '../../domain/setupValidation'
import { WEEKDAYS_MON_FIRST, WEEKDAY_LONG, formatDuration, toMinutes } from '../../domain/time'
import { EditableList } from '../../ui/EditableList'
import { DateInput, Field, Segmented, TimeInput, WeekdayPicker } from '../../ui/form'

const ENERGY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const satisfies readonly { value: Energy; label: string }[]

type WindowDraft = Omit<AvailabilityWindow, 'id'>

const byStart = (a: { start: string }, b: { start: string }) => toMinutes(a.start) - toMinutes(b.start)

export function EnergyTag({ energy }: { energy: Energy }) {
  return <span className={`energy energy-${energy}`}>{energy[0]!.toUpperCase() + energy.slice(1)} energy</span>
}

function DayCard({ weekday, windows }: { weekday: Weekday; windows: AvailabilityWindow[] }) {
  const [copying, setCopying] = useState(false)
  const [targets, setTargets] = useState<Weekday[]>([])
  const overlaps = findOverlappingWindows(windows).length > 0
  const total = weeklyAvailableMinutes(windows)

  async function copy() {
    const all = await repos.availabilityWindows.all()
    const replaced = all.filter((w) => targets.includes(w.weekday))
    if (replaced.length && !window.confirm('This replaces the existing free time on those days. Continue?')) return
    for (const w of replaced) await repos.availabilityWindows.remove(w.id)
    for (const d of targets) {
      for (const { id: _id, ...w } of windows) await repos.availabilityWindows.add({ ...w, weekday: d })
    }
    setCopying(false)
    setTargets([])
  }

  return (
    <div className="day-card">
      <div className="day-card-head">
        <h3>{WEEKDAY_LONG[weekday]}</h3>
        <span className="muted">{total ? formatDuration(total) : 'No free time'}</span>
        {windows.length > 0 && (
          <button type="button" className="btn small" onClick={() => setCopying(!copying)}>
            {copying ? 'Cancel' : 'Copy to…'}
          </button>
        )}
      </div>
      {copying && (
        <div className="copy-box">
          <WeekdayPicker value={targets} onChange={(t) => setTargets(t.filter((d) => d !== weekday))} />
          <button type="button" className="btn primary" disabled={!targets.length} onClick={copy}>
            Copy {WEEKDAY_LONG[weekday]} to {targets.length || 'selected'} day{targets.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
      <EditableList<AvailabilityWindow, WindowDraft>
        items={[...windows].sort(byStart)}
        empty="Not available."
        addLabel="Add free time"
        renderRow={(w) => (
          <span className="row-main">
            <strong>
              {w.start}–{w.end}
            </strong>
            <EnergyTag energy={w.energy} />
          </span>
        )}
        toDraft={({ id: _id, ...d }) => d}
        newDraft={() => {
          const last = [...windows].sort(byStart).at(-1)
          return { weekday, start: last?.end ?? '16:00', end: last ? '23:00' : '19:00', energy: 'normal' }
        }}
        validate={validateWindow}
        onSave={(d, id) => (id ? repos.availabilityWindows.put({ ...d, id }) : repos.availabilityWindows.add(d))}
        onDelete={(id) => repos.availabilityWindows.remove(id)}
        renderForm={(d, set) => (
          <div className="form-grid">
            <Field label="From">
              <TimeInput value={d.start} onChange={(start) => set({ ...d, start })} />
            </Field>
            <Field label="Until">
              <TimeInput value={d.end} onChange={(end) => set({ ...d, end })} />
            </Field>
            <Field label="Energy" hint="Demanding goals go to high-energy time, light ones to low.">
              <Segmented value={d.energy} options={ENERGY_OPTIONS} onChange={(energy) => set({ ...d, energy })} />
            </Field>
          </div>
        )}
      />
      {overlaps && <p className="warning">Some windows on this day overlap.</p>}
    </div>
  )
}

export function AvailabilitySection() {
  const windows = useLiveQuery(() => repos.availabilityWindows.all(), [])
  if (!windows) return null
  const total = weeklyAvailableMinutes(windows)
  return (
    <>
      <p className="muted">
        When could you work on goals, if nothing else were planned? Classes, meals and travel are subtracted
        automatically. {total > 0 && <strong>Total: {formatDuration(total)} per week.</strong>}
      </p>
      <div className="day-grid">
        {WEEKDAYS_MON_FIRST.map((d) => (
          <DayCard key={d} weekday={d} windows={windows.filter((w) => w.weekday === d)} />
        ))}
      </div>
    </>
  )
}

// ---------- One-off overrides ----------

type OverrideDraft = { date: string; kind: 'busy' | 'free'; allDay: boolean; start: string; end: string }

const toOverride = (d: OverrideDraft): Omit<AvailabilityOverride, 'id'> =>
  d.allDay ? { date: d.date, kind: d.kind } : { date: d.date, kind: d.kind, start: d.start, end: d.end }

const formatDay = (iso: string) => format(new Date(`${iso}T00:00`), 'EEE d MMM yyyy')

export function OverridesSection() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const overrides = useLiveQuery(() => repos.availabilityOverrides.all(), [])
  if (!overrides) return null
  const upcoming = overrides.filter((o) => o.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''))
  return (
    <EditableList<AvailabilityOverride, OverrideDraft>
      items={upcoming}
      empty="No upcoming changes. Add one for days that differ from your usual week."
      addLabel="Add one-off change"
      renderRow={(o) => (
        <span className="row-main">
          <strong>{formatDay(o.date)}</strong>
          <span className={o.kind === 'busy' ? 'badge busy' : 'badge free'}>{o.kind === 'busy' ? 'Busy' : 'Free'}</span>
          <span className="muted">{o.start ? `${o.start}–${o.end}` : 'all day'}</span>
        </span>
      )}
      toDraft={(o) => ({ date: o.date, kind: o.kind, allDay: !o.start, start: o.start ?? '13:00', end: o.end ?? '18:00' })}
      newDraft={() => ({ date: today, kind: 'busy', allDay: true, start: '13:00', end: '18:00' })}
      validate={(d) => validateOverride(toOverride(d))}
      onSave={(d, id) =>
        id ? repos.availabilityOverrides.put({ ...toOverride(d), id }) : repos.availabilityOverrides.add(toOverride(d))
      }
      onDelete={(id) => repos.availabilityOverrides.remove(id)}
      renderForm={(d, set) => (
        <div className="form-grid">
          <Field label="Date">
            <DateInput value={d.date} onChange={(date) => set({ ...d, date })} />
          </Field>
          <Field label="I’m…">
            <Segmented
              value={d.kind}
              options={[
                { value: 'busy', label: 'Busy' },
                { value: 'free', label: 'Free' },
              ]}
              onChange={(kind) => set({ ...d, kind, allDay: kind === 'free' ? false : d.allDay })}
            />
          </Field>
          {d.kind === 'busy' && (
            <Field label="When">
              <Segmented
                value={d.allDay ? 'all' : 'part'}
                options={[
                  { value: 'all', label: 'All day' },
                  { value: 'part', label: 'Part of the day' },
                ]}
                onChange={(v) => set({ ...d, allDay: v === 'all' })}
              />
            </Field>
          )}
          {!d.allDay && (
            <>
              <Field label="From">
                <TimeInput value={d.start} onChange={(start) => set({ ...d, start })} />
              </Field>
              <Field label="Until">
                <TimeInput value={d.end} onChange={(end) => set({ ...d, end })} />
              </Field>
            </>
          )}
        </div>
      )}
    />
  )
}
