import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { GoalCategory } from '../../db/types'
import { estimateHint } from '../../domain/learning'

/** "Your past exams took ~1.3× your estimate — use 20h instead of 15h?" (SPEC 3.4). The user decides. */
export function EstimateHintCard({ category, hours, today, excludeId, onUse, onKeep }: { category: GoalCategory; hours: number; today: string; excludeId?: string; onUse: (h: number) => void; onKeep: () => void }) {
  const hint = useLiveQuery(async () => {
    const [goals, sessions, logs] = await Promise.all([repos.goals.all(), repos.sessions.all(), repos.logEntries.all()])
    return estimateHint(category, hours, goals, sessions, logs, today, excludeId) ?? null
  }, [category, hours, today, excludeId])
  if (!hint) return null
  return (
    <div className="estimate-hint">
      <span>💡 {hint.message}</span>
      <button type="button" className="btn small primary" onClick={() => onUse(hint.suggestedHours)}>
        Use {hint.suggestedHours}h
      </button>
      <button type="button" className="btn small link" onClick={onKeep}>
        Keep {hours}h
      </button>
    </div>
  )
}
