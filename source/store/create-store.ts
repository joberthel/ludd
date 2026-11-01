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
  const defaultData = schema.parse({})
  const adapter = new JSONFile<z.output<TSchema>>(filePath)
  const db = new Low<z.output<TSchema>>(adapter, defaultData)

  return {
    filePath,
    async read() {
      const exists = await stat(filePath).then(() => true, () => false)
      if (!exists) {
        await mkdir(path.dirname(filePath), { recursive: true })
        const initial = structuredClone(defaultData)
        db.data = initial
        await db.write()
        return initial
      }
      await db.read()
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
