import { useState } from 'react'
import type { GoalType, Priority, TimeBucket } from '../../db/types'
import { CATEGORIES, COLORS, GOAL_TYPES, ICONS, blankGoal, type GoalDraft } from '../../domain/goals'
import { DateInput, Field, LocationSelect, NumberInput, Segmented, Switch, TextInput, useSettings } from '../../ui/form'
import { EstimateHintCard } from '../learning/EstimateHintCard'

/** Fields every goal type shares; kept when switching type. */
const SHARED = ['name', 'category', 'color', 'icon', 'priority', 'focus', 'preferredTime', 'locationId', 'active'] as const

/** Switch type: take that type's defaults, keep what the user already chose for shared fields. */
export function switchType(d: GoalDraft, type: GoalType, today: string): GoalDraft {
  const next = blankGoal(type, today)
  for (const k of SHARED) (next as Record<string, unknown>)[k] = d[k]
  return next
}

const num = (v: number) => (Number.isFinite(v) ? v : undefined)

export function GoalForm({ draft, set, today, isNew }: { draft: GoalDraft; set: (d: GoalDraft) => void; today: string; isNew: boolean }) {
  const settings = useSettings()
  const d = draft
  const up = (patch: Partial<GoalDraft>) => set({ ...d, ...patch })
  const [estimateHandled, setEstimateHandled] = useState(false)
  const customTimer = d.pomodoroWork !== undefined

  return (
    <>
      {/* ---------- Basics ---------- */}
      <div className="card">
        <div className="form-grid">
          <Field label="Name">
            <TextInput value={d.name} placeholder={d.type === 'book' ? 'Book title' : 'e.g. Algebra midterm'} onChange={(name) => up({ name })} />
          </Field>
          <Field label="Category">
            <select className="input" value={d.category} onChange={(e) => up({ category: e.target.value as GoalDraft['category'] })}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Colour" group>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === d.color ? 'swatch on' : 'swatch'}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={c === d.color}
                onClick={() => up({ color: c })}
              />
            ))}
          </div>
        </Field>
        <Field label="Icon (optional)" group>
          <div className="icons">
            {ICONS.map((i) => (
              <button key={i} type="button" className={i === d.icon ? 'icon-btn on' : 'icon-btn'} aria-pressed={i === d.icon} onClick={() => up({ icon: i === d.icon ? undefined : i })}>
                {i}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* ---------- Type ---------- */}
      <h2>What kind of goal?</h2>
      <div className="card">
        <Segmented value={d.type} options={GOAL_TYPES} onChange={(t) => set(switchType(d, t, today))} />
        <p className="muted type-hint">{GOAL_TYPES.find((t) => t.value === d.type)!.hint}</p>
        {!isNew && <p className="field-hint">Changing the type resets the type-specific fields below.</p>}

        {d.type === 'deadline' && (
          <div className="form-grid">
            <Field label="Deadline">
              <DateInput value={d.deadline ?? ''} onChange={(v) => up({ deadline: v || undefined })} />
            </Field>
            <Field label="Total work" hint="Your honest estimate.">
              <NumberInput value={d.totalHours ?? NaN} step={0.5} min={0} suffix="hours" onChange={(v) => up({ totalHours: num(v) })} />
            </Field>
            <Field label="Review days before the deadline" hint="Reserved for a final review.">
              <NumberInput value={d.reviewDays ?? NaN} min={0} max={14} suffix="days" onChange={(v) => up({ reviewDays: num(v) })} />
            </Field>
          </div>
        )}
        {d.type === 'deadline' && isNew && !estimateHandled && (d.totalHours ?? 0) > 0 && (
          <EstimateHintCard
            category={d.category}
            hours={d.totalHours!}
            today={today}
            onUse={(totalHours) => {
              setEstimateHandled(true) // don't re-apply the factor to the new number
              up({ totalHours })
            }}
            onKeep={() => setEstimateHandled(true)}
          />
        )}

        {d.type === 'recurring' && (
          <>
            <div className="form-grid">
              <Field label="Sessions per week">
                <NumberInput value={d.perWeek ?? NaN} min={1} max={7} suffix="× a week" onChange={(v) => up({ perWeek: num(v) })} />
              </Field>
              <Field label="Session length">
                <NumberInput value={d.sessionLength ?? NaN} min={5} suffix="min" onChange={(v) => up({ sessionLength: num(v) })} />
              </Field>
            </div>
            <Switch label="Rest day between sessions (no back-to-back days)" checked={!!d.noConsecutiveDays} onChange={(v) => up({ noConsecutiveDays: v })} />
          </>
        )}

        {d.type === 'ongoing' && (
          <div className="form-grid">
            <Field label="Target" group>
              <Segmented
                value={d.minutesPerDay !== undefined ? 'day' : 'week'}
                options={[
                  { value: 'day', label: 'Per day' },
                  { value: 'week', label: 'Per week' },
                ]}
                onChange={(v) =>
                  up(
                    v === 'day'
                      ? { minutesPerDay: d.minutesPerWeek ? Math.round(d.minutesPerWeek / 7) : 30, minutesPerWeek: undefined }
                      : { minutesPerWeek: d.minutesPerDay ? d.minutesPerDay * 7 : 150, minutesPerDay: undefined },
                  )
                }
              />
            </Field>
            {d.minutesPerDay !== undefined ? (
              <Field label="Minutes per day">
                <NumberInput value={d.minutesPerDay} min={1} suffix="min" onChange={(v) => up({ minutesPerDay: Number.isFinite(v) ? v : 0 })} />
              </Field>
            ) : (
              <Field label="Minutes per week">
                <NumberInput value={d.minutesPerWeek ?? NaN} min={1} suffix="min" onChange={(v) => up({ minutesPerWeek: num(v) })} />
              </Field>
            )}
            <Field label="End date (optional)">
              <DateInput value={d.endDate ?? ''} onChange={(v) => up({ endDate: v || undefined })} />
            </Field>
          </div>
        )}

        {d.type === 'book' && (
          <div className="form-grid">
            <Field label="Pages">
              <NumberInput value={d.totalPages ?? NaN} min={1} suffix="pages" onChange={(v) => up({ totalPages: num(v) })} />
            </Field>
            <Field label="Already read">
              <NumberInput value={d.pagesDone ?? NaN} min={0} suffix="pages" onChange={(v) => up({ pagesDone: num(v) })} />
            </Field>
            <Field label="Reading time">
              <NumberInput value={d.minutesPerDay ?? NaN} min={1} suffix="min a day" onChange={(v) => up({ minutesPerDay: num(v) })} />
            </Field>
            <Field label="Finish by (optional)">
              <DateInput value={d.deadline ?? ''} onChange={(v) => up({ deadline: v || undefined })} />
            </Field>
          </div>
        )}
      </div>

      {/* ---------- Planning ---------- */}
      <h2>Planning</h2>
      <div className="card">
        <div className="form-grid">
          <Field label="Priority" hint="Wins when goals compete for the same time." group>
            <Segmented<`${Priority}`>
              value={`${d.priority}`}
              options={[
                { value: '1', label: 'Low' },
                { value: '2', label: 'Medium' },
                { value: '3', label: 'High' },
              ]}
              onChange={(v) => up({ priority: Number(v) as Priority })}
            />
          </Field>
          <Field label="Focus" hint="Demanding goals go to your high-energy time." group>
            <Segmented
              value={d.focus}
              options={[
                { value: 'demanding', label: 'Demanding' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(focus) => up({ focus })}
            />
          </Field>
        </div>
        <div className="form-grid">
          {d.type !== 'recurring' && (
            <>
              <Field label="Shortest session">
                <NumberInput value={d.minSession} min={5} suffix="min" onChange={(v) => up({ minSession: v })} />
              </Field>
              <Field label="Longest session">
                <NumberInput value={d.maxSession} min={5} suffix="min" onChange={(v) => up({ maxSession: v })} />
              </Field>
            </>
          )}
          <Field label="Preferred time (optional)">
            <select className="input" value={d.preferredTime ?? ''} onChange={(e) => up({ preferredTime: (e.target.value || undefined) as TimeBucket | undefined })}>
              <option value="">Any time</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </Field>
          <Field label="Place (optional)" hint="Travel there is added automatically.">
            <LocationSelect value={d.locationId} emptyLabel="Anywhere" onChange={(locationId) => up({ locationId })} />
          </Field>
        </div>
      </div>

      {/* ---------- Focus timer ---------- */}
      <h2>Focus timer</h2>
      <div className="card">
        <Switch
          label={
            customTimer
              ? 'Custom focus timer for this goal'
              : `Custom focus timer for this goal (default ${settings?.pomodoroWork ?? 25}/${settings?.pomodoroBreak ?? 5})`
          }
          checked={customTimer}
          onChange={(on) =>
            up(
              on
                ? {
                    pomodoroWork: settings?.pomodoroWork ?? 25,
                    pomodoroBreak: settings?.pomodoroBreak ?? 5,
                    pomodoroLongBreak: settings?.pomodoroLongBreak ?? 15,
                    cyclesBeforeLong: settings?.cyclesBeforeLong ?? 4,
                  }
                : { pomodoroWork: undefined, pomodoroBreak: undefined, pomodoroLongBreak: undefined, cyclesBeforeLong: undefined },
            )
          }
        />
        {customTimer && (
          <div className="form-grid">
            <Field label="Focus">
              <NumberInput value={d.pomodoroWork!} suffix="min" onChange={(v) => up({ pomodoroWork: v })} />
            </Field>
            <Field label="Break">
              <NumberInput value={d.pomodoroBreak ?? NaN} suffix="min" onChange={(v) => up({ pomodoroBreak: v })} />
            </Field>
            <Field label="Long break">
              <NumberInput value={d.pomodoroLongBreak ?? NaN} suffix="min" onChange={(v) => up({ pomodoroLongBreak: v })} />
            </Field>
            <Field label="Cycles before long break">
              <NumberInput value={d.cyclesBeforeLong ?? NaN} onChange={(v) => up({ cyclesBeforeLong: v })} />
            </Field>
          </div>
        )}
      </div>
    </>
  )
}
