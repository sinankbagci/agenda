import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { reviewWeek, shouldShowReview } from '../../domain/review'

/** On Today: "Plan your week" on Sunday or until this week's review is confirmed (SPEC 4.4). */
export function ReviewBanner({ today }: { today: string }) {
  const state = useLiveQuery(async () => {
    const [reviews, d] = await Promise.all([repos.weeklyReviews.all(), db.meta.get('reviewDismissed')])
    return { reviews, dismissed: d ? (JSON.parse(d.value) as string[]) : [] }
  }, [])
  if (!state || !shouldShowReview(today, state.reviews, state.dismissed)) return null
  const sunday = new Date(`${today}T00:00`).getDay() === 0
  return (
    <div className="card review-banner">
      <span>
        🗓 <strong>{sunday ? 'Plan next week' : 'Plan your week'}</strong> — look back at last week and confirm the plan.
      </span>
      <span className="button-row">
        <Link to="/review" className="btn small primary">
          Open review
        </Link>
        <button
          type="button"
          className="btn small link"
          onClick={() => void db.meta.put({ key: 'reviewDismissed', value: JSON.stringify([...state.dismissed, reviewWeek(today)]) })}
        >
          Not now
        </button>
      </span>
    </div>
  )
}
