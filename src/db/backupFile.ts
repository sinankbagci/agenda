/** Browser-side file handling for backups (share sheet / download / file picker). */

export type SaveResult = 'shared' | 'downloaded' | 'cancelled'

/**
 * On iPad, open the share sheet (→ "Save to Files", AirDrop, …).
 * Falls back to a regular download where file sharing isn't supported.
 */
export async function saveJsonFile(fileName: string, json: string): Promise<SaveResult> {
  const file = new File([json], fileName, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // NotAllowedError etc. (e.g. the tap's user-activation expired): fall back to download.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
