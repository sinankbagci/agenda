import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { remainingMs } from '../../domain/focusTimer'
import { useNow } from '../../ui/useNow'

/** While a Focus timer runs and you're elsewhere in the app: a small pill that takes you back. */
export function FocusPill() {
  const { pathname } = useLocation()
  const timer = useLiveQuery(() => db.activeTimer.get('active'), [])
  const goal = useLiveQuery(() => (timer ? repos.goals.get(timer.goalId) : Promise.resolve(undefined)), [timer?.goalId])
  const now = useNow()
  if (!timer || pathname === '/focus') return null
  const left = remainingMs(timer, now.getTime())
  return (
    <Link to="/focus" className="focus-pill" style={{ ['--goal' as string]: goal?.color ?? 'var(--accent)' }}>
      ⏱ {goal?.name ?? 'Focus'} · {timer.pausedAt ? 'paused' : left > 0 ? `${Math.ceil(left / 60_000)} min left` : 'up next'}
    </Link>
  )
}
