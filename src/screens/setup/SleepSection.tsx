import { Field, Problems, TimeInput } from '../../ui/form'
import { useSettingsDraft } from '../../ui/useSettingsDraft'
import { validateSleep } from '../../domain/setupValidation'
import { formatDuration, isTime, spanMinutes } from '../../domain/time'

const KEYS = ['sleepStart', 'sleepEnd'] as const

export function SleepSection() {
  const { draft, set, check } = useSettingsDraft(KEYS, validateSleep)
  if (!draft) return null
  const ok = isTime(draft.sleepStart) && isTime(draft.sleepEnd) && draft.sleepStart !== draft.sleepEnd
  return (
    <div className="card">
      <div className="form-grid">
        <Field label="Bedtime">
          <TimeInput value={draft.sleepStart} onChange={(v) => set('sleepStart', v)} />
        </Field>
        <Field label="Wake up">
          <TimeInput value={draft.sleepEnd} onChange={(v) => set('sleepEnd', v)} />
        </Field>
      </div>
      {ok && <p className="muted">Nothing is ever planned during these {formatDuration(spanMinutes(draft.sleepStart, draft.sleepEnd))}.</p>}
      <Problems check={check} />
    </div>
  )
}
