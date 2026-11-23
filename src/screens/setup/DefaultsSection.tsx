import { Field, NumberInput, Problems } from '../../ui/form'
import { useSettingsDraft } from '../../ui/useSettingsDraft'
import type { Check } from '../../domain/setupValidation'

const KEYS = ['pomodoroWork', 'pomodoroBreak', 'pomodoroLongBreak', 'cyclesBeforeLong', 'calendarAlertMin'] as const

function validate(d: Record<(typeof KEYS)[number], number>): Check {
  const errors: string[] = []
  if (!(d.pomodoroWork >= 1 && d.pomodoroWork <= 180)) errors.push('Focus length must be 1–180 minutes.')
  if (!(d.pomodoroBreak >= 0 && d.pomodoroBreak <= 60)) errors.push('Short break must be 0–60 minutes.')
  if (!(d.pomodoroLongBreak >= 0 && d.pomodoroLongBreak <= 120)) errors.push('Long break must be 0–120 minutes.')
  if (!(Number.isInteger(d.cyclesBeforeLong) && d.cyclesBeforeLong >= 1 && d.cyclesBeforeLong <= 12))
    errors.push('Cycles before a long break must be 1–12.')
  if (!(d.calendarAlertMin >= 0 && d.calendarAlertMin <= 1440)) errors.push('Calendar alert must be 0–1440 minutes.')
  return { errors, warnings: [] }
}

export function DefaultsSection() {
  const { draft, set, check } = useSettingsDraft(KEYS, validate)
  if (!draft) return null
  return (
    <div className="card">
      <h3>Focus timer</h3>
      <div className="form-grid">
        <Field label="Focus">
          <NumberInput value={draft.pomodoroWork} suffix="min" onChange={(v) => set('pomodoroWork', v)} />
        </Field>
        <Field label="Short break">
          <NumberInput value={draft.pomodoroBreak} suffix="min" onChange={(v) => set('pomodoroBreak', v)} />
        </Field>
        <Field label="Long break">
          <NumberInput value={draft.pomodoroLongBreak} suffix="min" onChange={(v) => set('pomodoroLongBreak', v)} />
        </Field>
        <Field label="Cycles before long break">
          <NumberInput value={draft.cyclesBeforeLong} onChange={(v) => set('cyclesBeforeLong', v)} />
        </Field>
      </div>
      <h3>Calendar export</h3>
      <div className="form-grid">
        <Field label="Alert before each session">
          <NumberInput value={draft.calendarAlertMin} suffix="min" onChange={(v) => set('calendarAlertMin', v)} />
        </Field>
      </div>
      <Problems check={check} />
    </div>
  )
}
