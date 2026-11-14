import fs from 'node:fs'
import path from 'node:path'

/** Resolves symlinks for the nearest existing ancestor and re-appends the nonexistent tail. */
export function realpathNearest(target: string): string {
  const tail: string[] = []
  let current = target
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse())
    }
    catch {
      const parent = path.dirname(current)
      if (parent === current) {
        return target
      }
      tail.push(path.basename(current))
      current = parent
    }
  }
}
