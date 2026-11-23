import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { MealRule } from '../../db/types'
import { validateMeal } from '../../domain/setupValidation'
import { toMinutes } from '../../domain/time'
import { EditableList } from '../../ui/EditableList'
import { Field, LocationSelect, NumberInput, TextInput, TimeInput } from '../../ui/form'

type Draft = Omit<MealRule, 'id'>

const TYPICAL: Draft[] = [
  { name: 'Breakfast', windowStart: '08:00', windowEnd: '09:30', duration: 20 },
  { name: 'Lunch', windowStart: '12:00', windowEnd: '14:30', duration: 40 },
  { name: 'Dinner', windowStart: '19:00', windowEnd: '20:30', duration: 45 },
]

const byStart = (a: MealRule, b: MealRule) => toMinutes(a.windowStart) - toMinutes(b.windowStart)

export function MealsSection() {
  const meals = useLiveQuery(() => repos.mealRules.all(), [])
  if (!meals) return null
  return (
    <>
      <EditableList<MealRule, Draft>
        items={[...meals].sort(byStart)}
        empty="No meals yet. The planner places each meal somewhere inside its window, before anything else."
        addLabel="Add meal"
        renderRow={(m) => (
          <span className="row-main">
            <strong>{m.name}</strong>
            <span className="muted">
              {m.duration} min, between {m.windowStart}–{m.windowEnd}
            </span>
          </span>
        )}
        toDraft={({ id: _id, ...d }) => d}
        newDraft={() => ({ name: '', windowStart: '12:00', windowEnd: '13:00', duration: 30 })}
        validate={validateMeal}
        onSave={(d, id) => (id ? repos.mealRules.put({ ...d, id }) : repos.mealRules.add(d))}
        onDelete={(id) => repos.mealRules.remove(id)}
        renderForm={(d, set) => (
          <div className="form-grid">
            <Field label="Name">
              <TextInput value={d.name} placeholder="Lunch" onChange={(name) => set({ ...d, name })} />
            </Field>
            <Field label="Duration">
              <NumberInput value={d.duration} min={5} suffix="min" onChange={(duration) => set({ ...d, duration })} />
            </Field>
            <Field label="Window from">
              <TimeInput value={d.windowStart} onChange={(windowStart) => set({ ...d, windowStart })} />
            </Field>
            <Field label="Window until">
              <TimeInput value={d.windowEnd} onChange={(windowEnd) => set({ ...d, windowEnd })} />
            </Field>
            <Field label="Location" hint="Optional. Travel is added if you’re elsewhere.">
              <LocationSelect value={d.locationId} emptyLabel="Wherever I am" onChange={(locationId) => set({ ...d, locationId })} />
            </Field>
          </div>
        )}
      />
      {meals.length === 0 && (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            for (const m of TYPICAL) await repos.mealRules.add(m)
          }}
        >
          Add breakfast, lunch & dinner
        </button>
      )}
    </>
  )
}
