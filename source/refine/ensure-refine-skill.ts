import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLuddHome } from '../store/fs-utils.js'

export { getDefaultLuddHome }

export function getBundledRefineSkillPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, '../../skills/refine/SKILL.md')
}

export async function ensureRefineSkill(
  luddHomeDir: string = getDefaultLuddHome(),
  bundledSkillPath: string = getBundledRefineSkillPath(),
): Promise<string> {
  const targetPath = path.join(luddHomeDir, 'skills', 'refine', 'SKILL.md')

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(bundledSkillPath, targetPath)

  return targetPath
}
