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
