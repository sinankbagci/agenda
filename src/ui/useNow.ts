import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every 30 s and whenever the app becomes visible.
 * Display only — never use ticks to measure elapsed time (see Focus Mode rules).
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const id = setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return now
}
