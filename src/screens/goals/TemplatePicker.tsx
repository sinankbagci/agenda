import { Link } from 'react-router-dom'
import { TEMPLATES } from '../../domain/goals'

/** Grid of goal templates; each links to the form pre-filled. `base` is e.g. /goals/new. */
/** `replace`: swap the picker out of history (Goals tab) vs keep it (onboarding, so Back returns to the step). */
export function TemplatePicker({ base, replace = true, name }: { base: string; replace?: boolean; name?: string }) {
  return (
    <div className="template-grid">
      {TEMPLATES.map((t) => (
        <Link key={t.key} to={`${base}?template=${t.key}${name ? `&name=${encodeURIComponent(name)}` : ''}`} replace={replace} className="template">
          <span className="template-icon" aria-hidden>
            {t.icon}
          </span>
          <strong>{t.label}</strong>
          <span className="muted">{t.description}</span>
        </Link>
      ))}
    </div>
  )
}
