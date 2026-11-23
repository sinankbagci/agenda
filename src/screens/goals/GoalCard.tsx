import { Link } from 'react-router-dom'
import type { Goal } from '../../db/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import { FOCUS_LABEL, GOAL_TYPES, PRIORITY_LABEL, describeGoal } from '../../domain/goals'
import { topicProgress } from '../../domain/topics'
import type { Session } from '../../db/types'
import { CardProgress } from './GoalProgress'

export function GoalCard({ goal, to, today, sessions = [] }: { goal: Goal; to: string; today: string; sessions?: readonly Session[] }) {
  const topics = useLiveQuery(() => repos.topics.byGoal(goal.id), [goal.id], [])
  const tp = topicProgress(topics)
  return (
    <Link to={to} className={goal.active ? 'goal-card' : 'goal-card paused'} style={{ ['--goal' as string]: goal.color }}>
      <span className="goal-icon" aria-hidden>
        {goal.icon ?? goal.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="goal-main">
        <strong className="goal-name">{goal.name}</strong>
        <span className="muted">{describeGoal(goal, today)}</span>
        <CardProgress goal={goal} sessions={sessions.filter((s) => s.goalId === goal.id)} today={today} />
        {tp.total > 0 && (
          <span className="topic-progress">
            <span className="topic-bar" aria-hidden>
              <span style={{ width: `${(tp.done / tp.total) * 100}%` }} />
            </span>
            {tp.done} / {tp.total} topics done
          </span>
        )}
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
