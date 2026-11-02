import type { z } from 'zod'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'

export interface Store<TSchema extends z.ZodType> {
  readonly filePath: string
  read: () => Promise<z.output<TSchema>>
  write: (data: z.input<TSchema>) => Promise<z.output<TSchema>>
  update: (updater: (current: z.output<TSchema>) => z.input<TSchema>) => Promise<z.output<TSchema>>
}

export function createStore<TSchema extends z.ZodType>(
  filePath: string,
  schema: TSchema,
): Store<TSchema> {
  const parsedDefault = schema.safeParse({})
  const defaultData: z.output<TSchema> | null = parsedDefault.success
    ? parsedDefault.data
    : null
  const adapter = new JSONFile<z.output<TSchema> | null>(filePath)
  const db = new Low<z.output<TSchema> | null>(adapter, defaultData)

  return {
    filePath,
    async read() {
      const exists = await stat(filePath).then(() => true, () => false)
      if (!exists) {
        if (!parsedDefault.success) {
          throw new Error(`File "${filePath}" does not exist and schema has no defaults`)
        }
        await mkdir(path.dirname(filePath), { recursive: true })
        const initial = structuredClone(parsedDefault.data)
        db.data = initial
        await db.write()
        return initial
      }
      await db.read()
      if (db.data === null) {
        throw new Error(`File "${filePath}" contains null data`)
      }
      return schema.parse(db.data)
    },
    async write(data) {
      const validated = schema.parse(data)
      await mkdir(path.dirname(filePath), { recursive: true })
      db.data = validated
      await db.write()
      return validated
    },
    async update(updater) {
      const current = await this.read()
      const next = updater(current)
      return this.write(next)
    },
  }
}
