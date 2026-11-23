import Dexie, { type EntityTable } from 'dexie'

// Placeholder schema for step 1 (scaffold). The real schema from SPEC §6 arrives in step 2.
export interface Meta {
  key: string
  value: string
}

export const db = new Dexie('agenda') as Dexie & {
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  meta: 'key',
})
