import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function getDefaultLuddHome(): string {
  return path.join(os.homedir(), '.ludd')
}

export function getBundledRefineSkillPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, '../../skills/refine/SKILL.md')
}

export interface EnsureRefineSkillOptions {
  luddHomeDir?: string
  bundledSkillPath?: string
}

export async function ensureRefineSkill(
  optionsOrLuddHome?: EnsureRefineSkillOptions | string,
  bundledSkillPathOverride?: string,
): Promise<string> {
  let luddHomeDir: string | undefined
  let bundledSkillPath: string | undefined

  if (typeof optionsOrLuddHome === 'string') {
    luddHomeDir = optionsOrLuddHome
    bundledSkillPath = bundledSkillPathOverride
  }
  else if (optionsOrLuddHome !== undefined) {
    luddHomeDir = optionsOrLuddHome.luddHomeDir
    bundledSkillPath = optionsOrLuddHome.bundledSkillPath ?? bundledSkillPathOverride
  }

  const resolvedLuddHome = luddHomeDir ?? getDefaultLuddHome()
  const resolvedBundledSkill = bundledSkillPath ?? getBundledRefineSkillPath()
  const targetPath = path.join(resolvedLuddHome, 'skills', 'refine', 'SKILL.md')

  try {
    await fs.access(targetPath)
    return targetPath
  }
  catch {
    // Target skill does not exist, copy from bundled asset
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(resolvedBundledSkill, targetPath)

  return targetPath
}
