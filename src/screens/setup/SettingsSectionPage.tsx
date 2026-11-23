import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { SECTIONS, type SectionKey } from './sections'

export function SettingsSectionPage() {
  const { section } = useParams()
  const navigate = useNavigate()
  if (!section || !(section in SECTIONS)) return <Navigate to="/settings" replace />
  const { title, intro, Component } = SECTIONS[section as SectionKey]
  return (
    <section className="screen">
      <button type="button" className="back" onClick={() => navigate('/settings')}>
        ‹ Settings
      </button>
      <h1>{title}</h1>
      <p className="muted intro">{intro}</p>
      <Component base="/settings" />
    </section>
  )
}
