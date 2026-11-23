import { Link } from 'react-router-dom'
import { MORE_ITEMS } from '../app/routes'

const HINTS: Record<string, string> = {
  '/month': 'The whole month at a glance',
  '/log': 'Things you did outside the plan · daily check-in',
  '/lists': 'Want to watch · want to read',
  '/review': 'Weekly review',
  '/settings': 'Your week, places, limits, backup',
}

/** /more — everything that doesn't fit in the portrait tab bar. */
export function MoreScreen() {
  return (
    <section className="screen more-screen">
      <h1>More</h1>
      <ul className="list more-list">
        {MORE_ITEMS.flatMap((i) => {
          const row = (to: string, icon: string, label: string, hint?: string) => (
            <li key={to}>
              <Link to={to} className="list-item more-link">
                <span className="nav-icon" aria-hidden>
                  {icon}
                </span>
                <span className="more-text">
                  <strong>{label}</strong>
                  {hint && <span className="muted small">{hint}</span>}
                </span>
                <span className="chevron" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          )
          return i.path === '/review'
            ? [row(i.path, i.icon, i.label, HINTS[i.path]), row('/review/year', '✦', 'Year in review', 'Heatmap, totals, best streaks')]
            : [row(i.path, i.icon, i.label, HINTS[i.path])]
        })}
      </ul>
    </section>
  )
}
