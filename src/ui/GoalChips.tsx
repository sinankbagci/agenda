import type { Goal } from '../db/types'

/** Multi-select chips of goals ("Use it for: Reading, Algebra"). */
export function GoalChips({ goals, value, onChange }: { goals: readonly Goal[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!goals.length) return <p className="muted small">No goals that can use extra time yet.</p>
  const set = new Set(value)
  return (
    <div className="goal-chips">
      {goals.map((g) => (
        <button
          key={g.id}
          type="button"
          className={set.has(g.id) ? 'goal-chip on' : 'goal-chip'}
          style={{ ['--goal' as string]: g.color }}
          aria-pressed={set.has(g.id)}
          onClick={() => onChange(set.has(g.id) ? value.filter((x) => x !== g.id) : [...value, g.id])}
        >
          {g.icon && <span aria-hidden>{g.icon} </span>}
          {g.name}
        </button>
      ))}
    </div>
  )
}

/** Goals that can use extra free time: deadline, ongoing and book goals that are active (not recurring). */
export const boostableGoals = (goals: readonly Goal[]) => goals.filter((g) => g.active && g.type !== 'recurring')
