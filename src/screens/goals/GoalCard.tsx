import { Link } from 'react-router-dom'
import type { Goal } from '../../db/types'
import { FOCUS_LABEL, GOAL_TYPES, PRIORITY_LABEL, describeGoal } from '../../domain/goals'

export function GoalCard({ goal, to, today }: { goal: Goal; to: string; today: string }) {
  return (
    <Link to={to} className={goal.active ? 'goal-card' : 'goal-card paused'} style={{ ['--goal' as string]: goal.color }}>
      <span className="goal-icon" aria-hidden>
        {goal.icon ?? goal.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="goal-main">
        <strong className="goal-name">{goal.name}</strong>
        <span className="muted">{describeGoal(goal, today)}</span>
        <span className="goal-tags">
          <span className="tag">{GOAL_TYPES.find((t) => t.value === goal.type)!.label}</span>
          <span className="tag">{goal.category}</span>
          <span className="tag">{PRIORITY_LABEL[goal.priority]} priority</span>
          <span className="tag">{FOCUS_LABEL[goal.focus]}</span>
          {!goal.active && <span className="tag paused-tag">Paused</span>}
        </span>
      </span>
      <span className="chevron" aria-hidden>
        ›
      </span>
    </Link>
  )
}
