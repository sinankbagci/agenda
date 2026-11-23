import { Field, NumberInput, Problems } from '../../ui/form'
import { useSettingsDraft } from '../../ui/useSettingsDraft'
import { validateLimits } from '../../domain/setupValidation'

const KEYS = ['dailyCapWeekday', 'dailyCapWeekend', 'demandingCap', 'bufferMin'] as const

export function LimitsSection() {
  const { draft, set, check } = useSettingsDraft(KEYS, validateLimits)
  if (!draft) return null
  return (
    <div className="card">
      <div className="form-grid">
        <Field label="Max goal time on weekdays" hint="Total planned goal hours per day.">
          <NumberInput value={draft.dailyCapWeekday} step={0.5} min={0} max={24} suffix="h" onChange={(v) => set('dailyCapWeekday', v)} />
        </Field>
        <Field label="Max goal time on weekends">
          <NumberInput value={draft.dailyCapWeekend} step={0.5} min={0} max={24} suffix="h" onChange={(v) => set('dailyCapWeekend', v)} />
        </Field>
        <Field label="Max demanding time per day" hint="Hours of goals marked “demanding”.">
          <NumberInput value={draft.demandingCap} step={0.5} min={0} max={24} suffix="h" onChange={(v) => set('demandingCap', v)} />
        </Field>
        <Field label="Buffer between sessions">
          <NumberInput value={draft.bufferMin} min={0} max={120} suffix="min" onChange={(v) => set('bufferMin', v)} />
        </Field>
      </div>
      <Problems check={check} />
    </div>
  )
}
