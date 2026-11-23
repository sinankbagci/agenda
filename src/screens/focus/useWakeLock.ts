import { useEffect } from 'react'

/** Keep the screen on while `active` (Screen Wake Lock, where supported). Re-acquired on return. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (!active || !wl) return
    let lock: { release: () => Promise<void> } | undefined
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const l = await wl.request('screen')
        if (cancelled) void l.release()
        else lock = l
      } catch {
        // not allowed (e.g. low power mode) — the timer still works, the screen may just dim
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => {})
    }
  }, [active])
}
