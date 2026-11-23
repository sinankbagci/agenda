export interface NavItem {
  path: string
  label: string
  icon: string
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/today', label: 'Today', icon: '☀︎' },
  { path: '/week', label: 'Week', icon: '▦' },
  { path: '/month', label: 'Month', icon: '▤' },
  { path: '/goals', label: 'Goals', icon: '◎' },
  { path: '/focus', label: 'Focus', icon: '◷' },
  { path: '/log', label: 'Log', icon: '✎' },
  { path: '/lists', label: 'Lists', icon: '☰' },
  { path: '/review', label: 'Review', icon: '↺' },
  { path: '/settings', label: 'Settings', icon: '⚙︎' },
]

/** Portrait tab bar has room for 5: four screens + "More" (everything else, see MoreScreen). */
export const TAB_BAR_PATHS = ['/today', '/week', '/goals', '/focus']

/** Screens reached through "More" in portrait (the tab is highlighted on them). */
export const MORE_ITEMS: NavItem[] = NAV_ITEMS.filter((i) => !TAB_BAR_PATHS.includes(i.path))

export const isUnderMore = (pathname: string) =>
  pathname === '/more' || MORE_ITEMS.some((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))
