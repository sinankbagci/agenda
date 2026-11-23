import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { GoalCategory, NewRow, Rule, RuleKind, Weekday } from '../../db/types'
import { validateRule } from '../../domain/setupValidation'
import { WEEKDAYS_MON_FIRST, WEEKDAY_LONG } from '../../domain/time'
import { EditableList } from '../../ui/EditableList'
import { Field, TimeInput } from '../../ui/form'

type Draft = NewRow<Rule>

const CATEGORIES: GoalCategory[] = ['Study', 'Fitness', 'Reading', 'Learning', 'Other']

const KIND_LABEL: Record<RuleKind, string> = {
  noGoalAfter: 'No goals after a time',
  noGoalBefore: 'No goals before a time',
  keepFree: 'Keep a time free every week',
}

export function describeRule(r: Draft): string {
  switch (r.kind) {
    case 'noGoalAfter':
      return `No ${r.params.category ? r.params.category.toLowerCase() : 'goals'} after ${r.params.time}`
    case 'noGoalBefore':
      return `No ${r.params.category ? r.params.category.toLowerCase() : 'goals'} before ${r.params.time}`
    case 'keepFree':
      return `Keep ${WEEKDAY_LONG[r.params.weekday]} ${r.params.start}–${r.params.end} free`
  }
}

function blank(kind: RuleKind): Draft {
  switch (kind) {
    case 'noGoalAfter':
      return { kind, params: { time: '23:00' } }
    case 'noGoalBefore':
      return { kind, params: { time: '09:00' } }
    case 'keepFree':
      return { kind, params: { weekday: 0, start: '08:00', end: '12:00' } }
  }
}

export function RulesSection() {
  const rules = useLiveQuery(() => repos.rules.all(), [])
  if (!rules) return null
  return (
    <EditableList<Rule, Draft>
      items={rules}
      empty="No rules. Examples: “no study after 23:00”, “keep Sunday mornings free”."
      addLabel="Add rule"
      renderRow={(r) => (
        <span className="row-main">
          <strong>{describeRule(r)}</strong>
        </span>
      )}
      toDraft={({ id: _id, ...d }) => d as Draft}
      newDraft={() => blank('noGoalAfter')}
      validate={validateRule}
      onSave={(d, id) => (id ? repos.rules.put({ ...d, id } as Rule) : repos.rules.add(d))}
      onDelete={(id) => repos.rules.remove(id)}
      renderForm={(d, set) => (
        <div className="form-grid">
          <Field label="Rule">
            <select className="input" value={d.kind} onChange={(e) => set(blank(e.target.value as RuleKind))}>
              {(Object.keys(KIND_LABEL) as RuleKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {d.kind !== 'keepFree' ? (
            <>
              <Field label="Time">
                <TimeInput value={d.params.time} onChange={(time) => set({ ...d, params: { ...d.params, time } })} />
              </Field>
              <Field label="Applies to">
                <select
                  className="input"
                  value={d.params.category ?? ''}
                  onChange={(e) =>
                    set({ ...d, params: { ...d.params, category: (e.target.value || undefined) as GoalCategory | undefined } })
                  }
                >
                  <option value="">All goals</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c} only
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Day">
                <select
                  className="input"
                  value={d.params.weekday}
                  onChange={(e) => set({ ...d, params: { ...d.params, weekday: Number(e.target.value) as Weekday } })}
                >
                  {WEEKDAYS_MON_FIRST.map((w) => (
                    <option key={w} value={w}>
                      {WEEKDAY_LONG[w]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="From">
                <TimeInput value={d.params.start} onChange={(start) => set({ ...d, params: { ...d.params, start } })} />
              </Field>
              <Field label="Until">
                <TimeInput value={d.params.end} onChange={(end) => set({ ...d, params: { ...d.params, end } })} />
              </Field>
            </>
          )}
        </div>
      )}
    />
  )
}
