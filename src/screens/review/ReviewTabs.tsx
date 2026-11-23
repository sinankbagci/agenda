import { NavLink } from 'react-router-dom'

/** Weekly / Year switch shown at the top of both review screens. */
export function ReviewTabs() {
  return (
    <nav className="segmented review-tabs" aria-label="Review">
      <NavLink to="/review" end className={({ isActive }) => (isActive ? 'seg on' : 'seg')}>
        This week
      </NavLink>
      <NavLink to="/review/year" className={({ isActive }) => (isActive ? 'seg on' : 'seg')}>
        Year in review
      </NavLink>
    </nav>
  )
}
