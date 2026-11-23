import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { NAV_ITEMS, TAB_BAR_PATHS, isUnderMore } from './routes'
import { DayScreen } from '../screens/plan/DayScreen'
import { usePlanKeeper } from './usePlanKeeper'
import { FocusPill } from '../screens/focus/FocusPill'
import { FocusScreen } from '../screens/focus/FocusScreen' // also used by Today / goal pages
import { useSettings } from '../ui/form'

// Today loads with the app; every other screen is its own chunk (all precached for offline use).
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))
const SettingsScreen = named(() => import('../screens/SettingsScreen'), 'SettingsScreen')
const SettingsSectionPage = named(() => import('../screens/setup/SettingsSectionPage'), 'SettingsSectionPage')
const FixedBlockEditScreen = named(() => import('../screens/setup/FixedBlockEditScreen'), 'FixedBlockEditScreen')
const Onboarding = named(() => import('../screens/onboarding/Onboarding'), 'Onboarding')
const GoalsScreen = named(() => import('../screens/goals/GoalsScreen'), 'GoalsScreen')
const GoalEditScreen = named(() => import('../screens/goals/GoalEditScreen'), 'GoalEditScreen')
const GoalDetailScreen = named(() => import('../screens/goals/GoalDetailScreen'), 'GoalDetailScreen')
const WeekScreen = named(() => import('../screens/plan/WeekScreen'), 'WeekScreen')
const MonthScreen = named(() => import('../screens/plan/MonthScreen'), 'MonthScreen')
const LogScreen = named(() => import('../screens/log/LogScreen'), 'LogScreen')
const ListsScreen = named(() => import('../screens/lists/ListsScreen'), 'ListsScreen')
const WeeklyReviewScreen = named(() => import('../screens/review/WeeklyReviewScreen'), 'WeeklyReviewScreen')
const YearReviewScreen = named(() => import('../screens/review/YearReviewScreen'), 'YearReviewScreen')
const MoreScreen = named(() => import('../screens/MoreScreen'), 'MoreScreen')

/** Main layout: sidebar (landscape) / tab bar (portrait). */
function Shell() {
  const { pathname } = useLocation()
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
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
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
        <NavLink to="/more" className={() => (isUnderMore(pathname) ? 'tab-link active' : 'tab-link')}>
          <span className="nav-icon" aria-hidden>
            ⋯
          </span>
          <span className="tab-label">More</span>
        </NavLink>
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
    <Suspense fallback={null}>
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
        <Route path="/review/year" element={<YearReviewScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/goals/new" element={<GoalEditScreen />} />
        <Route path="/goals/:id" element={<GoalDetailScreen />} />
        <Route path="/goals/:id/edit" element={<GoalEditScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/settings/fixed/:id" element={<FixedBlockEditScreen />} />
        <Route path="/settings/:section" element={<SettingsSectionPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
