import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { applySessionLength, energySuggestions, sessionLengthSuggestions, type Suggestion } from '../../domain/learning'

/** Current suggestions (energy tags, session length), minus dismissed ones. undefined while loading. */
export function useSuggestions(today: string, goalId?: string): Suggestion[] | undefined {
  return useLiveQuery(async () => {
    const [windows, sessions, checkIns, goals, dismissedRow] = await Promise.all([
      repos.availabilityWindows.all(),
      repos.sessions.all(),
      repos.checkIns.all(),
      repos.goals.all(),
      db.meta.get('dismissedSuggestions'),
    ])
    const dismissed = new Set<string>(dismissedRow ? JSON.parse(dismissedRow.value) : [])
    const all = [...energySuggestions(windows, sessions, checkIns, today), ...sessionLengthSuggestions(goals, sessions, today)]
    return all.filter((s) => !dismissed.has(s.key) && (!goalId || (s.kind === 'sessionLength' && s.goalId === goalId)))
  }, [today, goalId])
}

async function dismiss(key: string) {
  const row = await db.meta.get('dismissedSuggestions')
  const keys: string[] = row ? JSON.parse(row.value) : []
  await db.meta.put({ key: 'dismissedSuggestions', value: JSON.stringify([...keys, key]) })
}

/** Apply = exactly the change described; the plan re-plans by itself (inputs changed). */
async function apply(s: Suggestion) {
  if (s.kind === 'energy') {
    for (const id of s.windowIds) await repos.availabilityWindows.update(id, { energy: s.to })
  } else {
    const goal = await repos.goals.get(s.goalId)
    if (goal) await repos.goals.update(goal.id, applySessionLength(goal, s.to))
  }
}

/** "💡 Suggestions" — learned from your history; nothing changes until you tap Apply (SPEC 4.1c). */
export function SuggestionsCard({ today, goalId, max = 3 }: { today: string; goalId?: string; max?: number }) {
  const list = useSuggestions(today, goalId)
  if (!list?.length) return null
  return (
    <section className="suggestions" aria-label="Suggestions">
      <h2>💡 Suggestions</h2>
      <p className="muted small">From the last few weeks of your plan and check-ins. Nothing changes unless you apply it.</p>
      <ul>
        {list.slice(0, max).map((s) => (
          <li key={s.key} className="card suggestion">
            <p>{s.message}</p>
            <div className="button-row">
              <button type="button" className="btn primary small" onClick={() => void apply(s)}>
                {s.kind === 'energy' ? `Mark it ${s.to}` : 'Apply'}
              </button>
              <button type="button" className="btn small link" onClick={() => void dismiss(s.key)}>
                Not now
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
