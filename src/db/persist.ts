import { db } from './db'

/** Ask the browser not to evict our IndexedDB data. Safe to call on every launch. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    const already = await navigator.storage.persisted()
    const granted = already || (await navigator.storage.persist())
    await db.meta.put({ key: 'storagePersisted', value: String(granted) })
    return granted
  } catch {
    return false
  }
}

/** Remember when the app was first opened (the backup reminder counts from it until the first backup). */
export async function recordFirstLaunch(now: number): Promise<void> {
  try {
    if (!(await db.meta.get('firstLaunchAt'))) await db.meta.put({ key: 'firstLaunchAt', value: String(now) })
  } catch {
    // storage unavailable: the reminder simply waits for a backup date
  }
}
