import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { syncFocus, type SyncResult } from '../../db/focusStore'
import { playBell, playChime } from '../../ui/feedback'
import { useSettings } from '../../ui/form'

const SYNC_MS = 5_000

/**
 * The running Focus timer for the UI. `now` re-renders the countdown 4× a second — display only;
 * all time comes from the stored timestamps. Every few seconds (and on return to the app) the
 * timer is synced: finished phases stored, sessions auto-completed, a soft bell on phase changes.
 */
export function useFocus(onAutoComplete?: (ids: string[]) => void, onFinished?: () => void) {
  const timer = useLiveQuery(() => db.activeTimer.get('active').then((t) => t ?? null), [])
  const settings = useSettings()
  const [now, setNow] = useState(() => Date.now())
  const [sync, setSync] = useState<SyncResult>()
  const busy = useRef(false)
  const cb = useRef({ onAutoComplete, onFinished, sound: true })
  cb.current = { onAutoComplete, onFinished, sound: settings?.completionSound ?? true }
  const running = !!timer

  const doSync = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const r = await syncFocus(Date.now())
      setSync(r)
      const visible = document.visibilityState === 'visible'
      if (r.transitions > 0 && visible && cb.current.sound) playBell(r.timer?.phase === 'work')
      if (r.autoCompleted.length) {
        if (visible && cb.current.sound) playChime()
        cb.current.onAutoComplete?.(r.autoCompleted)
      }
      if (r.finished) cb.current.onFinished?.()
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!running) return
    void doSync()
    const tick = setInterval(() => setNow(Date.now()), 250)
    const syncer = setInterval(() => void doSync(), SYNC_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      void doSync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tick)
      clearInterval(syncer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, doSync])

  // sync right when the displayed phase runs out, so the bell is on time
  useEffect(() => {
    if (!timer || timer.pausedAt) return
    const ms = timer.phaseStartedAt + timer.phaseLength * 60_000 - Date.now()
    if (ms <= 0) return
    const id = setTimeout(() => void doSync(), ms + 50)
    return () => clearTimeout(id)
  }, [timer, doSync])

  return { timer, now, sync, doSync }
}
