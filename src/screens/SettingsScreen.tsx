import { useEffect, useState } from 'react'
import { pwaInfo } from 'virtual:pwa-info'
import { Link } from 'react-router-dom'
import { BackupSection } from './settings/BackupSection'
import { SECTIONS, SETTINGS_ORDER } from './setup/sections'
import { useSetupSummary } from './setup/useSetupSummary'

function useStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function SettingsScreen() {
  const summary = useSetupSummary()
  const standalone = useStandalone()
  const [online, setOnline] = useState(navigator.onLine)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [offlineReady, setOfflineReady] = useState<boolean | null>(null)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then((r) => setOfflineReady(!!r?.active)).catch(() => setOfflineReady(false))
    } else {
      setOfflineReady(false)
    }
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false))
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const row = (label: string, ok: boolean | null, yes: string, no: string) => (
    <li className="status-row">
      <span>{label}</span>
      <span className={ok ? 'ok' : 'warn'}>{ok === null ? '…' : ok ? yes : no}</span>
    </li>
  )

  return (
    <section className="screen">
      <h1>Settings</h1>
      <h2>Your week</h2>
      <div className="list">
        {SETTINGS_ORDER.map((key) => (
          <Link key={key} to={`/settings/${key}`} className="list-item">
            <span className="row-main">
              <strong>{SECTIONS[key].title}</strong>
              <span className="muted">{summary[key] ?? ''}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        ))}
        <Link to="/onboarding/welcome" className="list-add">
          Run first-time setup again
        </Link>
      </div>

      <BackupSection />

      <h2>App status</h2>
      <ul className="status-list">
        {row('Installed to Home Screen', standalone, 'Yes', 'No — open in Safari → Share → Add to Home Screen')}
        {row('Offline ready', offlineReady, 'Yes', 'Not yet — reload once while online')}
        {row('Network', online, 'Online', 'Offline')}
        {row('Persistent storage', persisted, 'Granted', 'Not granted')}
      </ul>
      <p className="muted small">Build {__BUILD_TIME__}{pwaInfo ? '' : ' · dev (no service worker)'}</p>
    </section>
  )
}
