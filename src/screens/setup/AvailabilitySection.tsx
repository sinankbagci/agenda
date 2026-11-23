import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, differenceInCalendarDays, format } from 'date-fns'
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
import { GoalChips, boostableGoals } from '../../ui/GoalChips'
import { groupOverrides, type OverrideGroup } from '../../domain/oneOff'
import type { Check } from '../../domain/setupValidation'

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
            <Field label="Energy" hint="Demanding goals go to high-energy time, light ones to low." group>
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

type OverrideDraft = {
  from: string
  to: string
  kind: 'busy' | 'free'
  allDay: boolean
  start: string
  end: string
  energy: Energy
  boostGoalIds: string[]
}

const toOverride = (d: OverrideDraft, date: string): Omit<AvailabilityOverride, 'id'> => {
  if (d.allDay) return { date, kind: d.kind }
  const o: Omit<AvailabilityOverride, 'id'> = { date, kind: d.kind, start: d.start, end: d.end }
  if (d.kind === 'free') {
    o.energy = d.energy
    if (d.boostGoalIds.length) o.boostGoalIds = d.boostGoalIds
  }
  return o
}

const formatDay = (iso: string) => format(new Date(`${iso}T00:00`), 'EEE d MMM yyyy')
const nextIso = (iso: string) => format(addDays(new Date(`${iso}T00:00`), 1), 'yyyy-MM-dd')

function validateDraft(d: OverrideDraft): Check {
  const c = validateOverride(toOverride(d, d.from))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.to) || d.to < d.from) c.errors.push('The last day must be on or after the first day.')
  else if (differenceInCalendarDays(new Date(`${d.to}T00:00`), new Date(`${d.from}T00:00`)) >= 31) c.errors.push('At most 31 days at a time.')
  return c
}

/** Save a change over a range of days: one row per day, sharing a group id so it lists / edits as one. */
async function saveGroup(d: OverrideDraft, replaceIds: string[]) {
  for (const id of replaceIds) await repos.availabilityOverrides.remove(id)
  const groupId = d.to > d.from ? crypto.randomUUID() : undefined
  for (let date = d.from; date <= d.to; date = nextIso(date)) {
    const o = toOverride(d, date)
    if (groupId) o.groupId = groupId
    await repos.availabilityOverrides.add(o)
  }
}

type Row = OverrideGroup & { id: string }

export function OverridesSection({ from: fromDate, to: toDate }: { from?: string; to?: string } = {}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const overrides = useLiveQuery(() => repos.availabilityOverrides.all(), [])
  const goals = useLiveQuery(() => repos.goals.all(), [], [])
  if (!overrides) return null
  const goalNames = (ids?: string[]) => (ids ?? []).map((id) => goals.find((g) => g.id === id)?.name).filter(Boolean).join(', ')
  const rows: Row[] = groupOverrides(overrides)
    .filter((g) => g.to >= (fromDate ?? today) && (!toDate || g.from <= toDate))
    .map((g) => ({ ...g, id: g.key }))
  return (
    <EditableList<Row, OverrideDraft>
      items={rows}
      empty="No upcoming changes. Add one for days that differ from your usual week."
      addLabel="Add one-off change"
      renderRow={(g) => {
        const o = g.override
        return (
          <span className="row-main">
            <strong>{g.from === g.to ? formatDay(g.from) : `${formatDay(g.from)} – ${formatDay(g.to)}`}</strong>
            <span className={o.kind === 'busy' ? 'badge busy' : 'badge free'}>{o.kind === 'busy' ? 'Busy' : 'Free'}</span>
            <span className="muted">{o.start ? `${o.start}–${o.end}` : 'all day'}</span>
            {o.kind === 'free' && o.energy && o.energy !== 'normal' && <EnergyTag energy={o.energy} />}
            {o.boostGoalIds?.length ? <span className="muted">for {goalNames(o.boostGoalIds)}</span> : null}
          </span>
        )
      }}
      toDraft={(g) => ({
        from: g.from,
        to: g.to,
        kind: g.override.kind,
        allDay: !g.override.start,
        start: g.override.start ?? '13:00',
        end: g.override.end ?? '18:00',
        energy: g.override.energy ?? 'normal',
        boostGoalIds: g.override.boostGoalIds ?? [],
      })}
      newDraft={() => ({ from: fromDate && fromDate > today ? fromDate : today, to: fromDate && fromDate > today ? fromDate : today, kind: 'busy', allDay: true, start: '13:00', end: '18:00', energy: 'normal', boostGoalIds: [] })}
      validate={validateDraft}
      onSave={(d, id) => saveGroup(d, id ? rows.find((r) => r.id === id)?.ids ?? [] : [])}
      onDelete={async (id) => {
        for (const x of rows.find((r) => r.id === id)?.ids ?? []) await repos.availabilityOverrides.remove(x)
      }}
      renderForm={(d, set) => (
        <div className="form-grid">
          <Field label="From day">
            <DateInput value={d.from} onChange={(from) => set({ ...d, from, to: d.to < from ? from : d.to })} />
          </Field>
          <Field label="To day">
            <DateInput value={d.to} onChange={(to) => set({ ...d, to })} />
          </Field>
          <Field label="I’m…" group>
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
            <Field label="When" group>
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
          {d.kind === 'free' && (
            <>
              <Field label="Energy" group>
                <Segmented value={d.energy} options={ENERGY_OPTIONS} onChange={(energy) => set({ ...d, energy })} />
              </Field>
              <Field label="Use it for (optional)" group>
                <GoalChips goals={boostableGoals(goals)} value={d.boostGoalIds} onChange={(boostGoalIds) => set({ ...d, boostGoalIds })} />
              </Field>
            </>
          )}
        </div>
      )}
    />
  )
}
