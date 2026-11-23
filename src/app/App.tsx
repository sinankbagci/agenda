import { useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { NAV_ITEMS, TAB_BAR_PATHS } from './routes'
import { Placeholder } from '../screens/Placeholder'
import { SettingsScreen } from '../screens/SettingsScreen'
import { SettingsSectionPage } from '../screens/setup/SettingsSectionPage'
import { FixedBlockEditScreen } from '../screens/setup/FixedBlockEditScreen'
import { Onboarding } from '../screens/onboarding/Onboarding'
import { GoalsScreen } from '../screens/goals/GoalsScreen'
import { GoalEditScreen } from '../screens/goals/GoalEditScreen'
import { GoalDetailScreen } from '../screens/goals/GoalDetailScreen'
import { DayScreen } from '../screens/plan/DayScreen'
import { WeekScreen } from '../screens/plan/WeekScreen'
import { MonthScreen } from '../screens/plan/MonthScreen'
import { usePlanKeeper } from './usePlanKeeper'
import { FocusScreen } from '../screens/focus/FocusScreen'
import { FocusPill } from '../screens/focus/FocusPill'
import { LogScreen } from '../screens/log/LogScreen'
import { ListsScreen } from '../screens/lists/ListsScreen'
import { WeeklyReviewScreen } from '../screens/review/WeeklyReviewScreen'
import { useSettings } from '../ui/form'

/** Main layout: sidebar (landscape) / tab bar (portrait). */
function Shell() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Agenda</div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} className="nav-link">
            <span className="nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="main">
        <Outlet />
      </main>
      <FocusPill />

      <nav className="tabbar" aria-label="Tabs">
        {NAV_ITEMS.filter((i) => TAB_BAR_PATHS.includes(i.path)).map((item) => (
          <NavLink key={item.path} to={item.path} className="tab-link">
            <span className="nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="tab-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function App() {
  const settings = useSettings()
  const { pathname } = useLocation()
  // First-run setup is decided once, at launch. Re-checking on every render would bounce
  // "Go to Today"/"Skip" back into onboarding before the settings save is visible.
  const [launch, setLaunch] = useState<'pending' | 'redirect' | 'done'>('pending')
  const inOnboarding = pathname.startsWith('/onboarding')

  useEffect(() => {
    if (launch === 'pending' && settings) setLaunch(!settings.onboardingDone && !inOnboarding ? 'redirect' : 'done')
    else if (launch === 'redirect' && inOnboarding) setLaunch('done')
  }, [launch, settings, inOnboarding])

  usePlanKeeper(launch === 'done')

  if (launch === 'pending') return null // first IndexedDB read takes a few ms
  if (launch === 'redirect' && !inOnboarding) return <Navigate to="/onboarding/welcome" replace />

  return (
    <Routes>
      <Route path="/onboarding/fixed/:id" element={<div className="onboarding"><FixedBlockEditScreen /></div>} />
      <Route path="/onboarding/goal/:id" element={<div className="onboarding"><GoalEditScreen base="/onboarding/goal" /></div>} />
      <Route path="/onboarding/:step?" element={<Onboarding />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<DayScreen />} />
        <Route path="/day/:date" element={<DayScreen />} />
        <Route path="/week" element={<WeekScreen />} />
        <Route path="/week/:date" element={<WeekScreen />} />
        <Route path="/month" element={<MonthScreen />} />
        <Route path="/month/:month" element={<MonthScreen />} />
        <Route path="/focus" element={<FocusScreen />} />
        <Route path="/log" element={<LogScreen />} />
        <Route path="/lists" element={<ListsScreen />} />
        <Route path="/review" element={<WeeklyReviewScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/goals/new" element={<GoalEditScreen />} />
        <Route path="/goals/:id" element={<GoalDetailScreen />} />
        <Route path="/goals/:id/edit" element={<GoalEditScreen />} />
        {NAV_ITEMS.filter((i) => !['/settings', '/goals', '/today', '/week', '/month', '/focus', '/log', '/lists', '/review'].includes(i.path)).map((item) => (
          <Route key={item.path} path={item.path} element={<Placeholder title={item.label} />} />
        ))}
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/settings/fixed/:id" element={<FixedBlockEditScreen />} />
        <Route path="/settings/:section" element={<SettingsSectionPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  )
}
