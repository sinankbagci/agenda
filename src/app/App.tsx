import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { NAV_ITEMS, TAB_BAR_PATHS } from './routes'
import { Placeholder } from '../screens/Placeholder'
import { SettingsScreen } from '../screens/SettingsScreen'

export function App() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Agenda</div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} className="nav-link">
            <span className="nav-icon" aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          {NAV_ITEMS.filter((i) => i.path !== '/settings').map((item) => (
            <Route key={item.path} path={item.path} element={<Placeholder title={item.label} />} />
          ))}
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Tabs">
        {NAV_ITEMS.filter((i) => TAB_BAR_PATHS.includes(i.path)).map((item) => (
          <NavLink key={item.path} to={item.path} className="tab-link">
            <span className="nav-icon" aria-hidden>{item.icon}</span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
