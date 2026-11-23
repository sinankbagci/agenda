import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import { requestPersistentStorage } from './db/persist'
import './styles.css'

// Register the service worker on every launch so the app is cached for offline use.
// autoUpdate: a new deploy activates on the next launch.
registerSW({ immediate: true })
void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
