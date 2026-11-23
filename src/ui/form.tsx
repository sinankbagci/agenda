import { useEffect, useId, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../db/repositories'
import type { Check } from '../domain/setupValidation'
import type { Weekday } from '../db/types'
import { WEEKDAYS_MON_FIRST, WEEKDAY_SHORT } from '../domain/time'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** Native iOS time wheel. Value is 'HH:mm' or ''. */
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="input" type="time" value={value} onChange={(e) => onChange(e.target.value)} />
}

export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input className="input" type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  )
}

/**
 * Number input that lets the field be empty while typing; reports NaN when empty.
 * Uses inputMode so iPad shows the number pad.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '')
  useEffect(() => {
    if (Number(text) !== value) setText(Number.isFinite(value) ? String(value) : '')
  }, [value])
  return (
    <span className="number-input">
      <input
        className="input"
        type="number"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value === '' ? NaN : Number(e.target.value))
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function WeekdayPicker({ value, onChange }: { value: Weekday[]; onChange: (v: Weekday[]) => void }) {
  const set = new Set(value)
  return (
    <div className="weekday-picker">
      {WEEKDAYS_MON_FIRST.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={set.has(d)}
          className={set.has(d) ? 'day on' : 'day'}
          onClick={() => {
            const next = new Set(set)
            if (next.has(d)) next.delete(d)
            else next.add(d)
            onChange(WEEKDAYS_MON_FIRST.filter((x) => next.has(x)))
          }}
        >
          {WEEKDAY_SHORT[d]}
        </button>
      ))}
    </div>
  )
}

const NEW_PLACE = '__new__'

/** Location dropdown fed live from the database, with "+ New place…". undefined = no location. */
export function LocationSelect({
  value,
  onChange,
  emptyLabel = 'No location',
}: {
  value: string | undefined
  onChange: (id: string | undefined) => void
  emptyLabel?: string
}) {
  const locations = useLiveQuery(() => repos.locations.all(), [], [])
  const id = useId()
  return (
    <select
      id={id}
      className="input"
      value={value ?? ''}
      onChange={async (e) => {
        if (e.target.value !== NEW_PLACE) return onChange(e.target.value || undefined)
        const name = window.prompt('Name of the new place (e.g. Campus, Gym):')?.trim()
        if (!name) return
        const existing = locations.find((l) => l.name.toLowerCase() === name.toLowerCase())
        onChange((existing ?? (await repos.locations.add({ name }))).id)
      }}
    >
      <option value="">{emptyLabel}</option>
      {[...locations]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      <option value={NEW_PLACE}>+ New place…</option>
    </select>
  )
}

export function Problems({ check }: { check: Check }) {
  if (!check.errors.length && !check.warnings.length) return null
  return (
    <div className="problems" role="alert">
      {check.errors.map((e) => (
        <p key={e} className="error">
          {e}
        </p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} className="warning">
          {w}
        </p>
      ))}
    </div>
  )
}

export const hasErrors = (c: Check) => c.errors.length > 0

/** Settings row, always complete. undefined while loading. */
export function useSettings() {
  return useLiveQuery(() => repos.settings.get(), [])
}

/** iOS-style on/off switch with a label. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
