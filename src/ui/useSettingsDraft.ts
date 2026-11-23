import { useEffect, useState } from 'react'
import { repos } from '../db/repositories'
import type { Settings } from '../db/types'
import type { Check } from '../domain/setupValidation'
import { useSettings } from './form'

type Editable = Omit<Settings, 'id'>

/**
 * Local draft of some settings fields that auto-saves on every valid change.
 * Invalid input stays on screen (with its errors) and isn't saved.
 */
export function useSettingsDraft<K extends keyof Editable>(keys: readonly K[], validate: (d: Pick<Editable, K>) => Check) {
  const settings = useSettings()
  const [draft, setDraft] = useState<Pick<Editable, K> | null>(null)

  useEffect(() => {
    if (settings && draft === null) {
      setDraft(Object.fromEntries(keys.map((k) => [k, settings[k]])) as unknown as Pick<Editable, K>)
    }
  }, [settings, draft, keys])

  const check = draft ? validate(draft) : { errors: [], warnings: [] }

  const set = <F extends K>(field: F, value: Editable[F]) => {
    if (!draft) return
    const next = { ...draft, [field]: value }
    setDraft(next)
    if (validate(next).errors.length === 0) void repos.settings.update(next)
  }

  return { draft, set, check }
}
