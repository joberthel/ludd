import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureRefineSkill,
  getBundledRefineSkillPath,
  getDefaultLuddHome,
} from './ensure-refine-skill.js'

describe('ensureRefineSkill', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ludd-refine-skill-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  it('resolves the default ludd home directory in ~/.ludd', () => {
    expect(getDefaultLuddHome()).toBe(path.join(os.homedir(), '.ludd'))
  })

  it('points getBundledRefineSkillPath to existing repo skill asset', async () => {
    const bundledPath = getBundledRefineSkillPath()
    const content = await fs.readFile(bundledPath, 'utf8')
    expect(content).toContain('name: refine')
    expect(content).toContain('complete_refinement')
    expect(content).toContain('ask_question')
  })

  it('copies bundled skill into <luddHome>/skills/refine/SKILL.md when missing', async () => {
    const targetFile = await ensureRefineSkill(tempDir)
    expect(targetFile).toBe(path.join(tempDir, 'skills', 'refine', 'SKILL.md'))

    const content = await fs.readFile(targetFile, 'utf8')
    expect(content).toContain('name: refine')
    expect(content).toContain('complete_refinement')
  })

  it('re-throws unexpected filesystem errors other than EEXIST', async () => {
    const nonExistentBundledPath = path.join(tempDir, 'non-existent-source.md')
    await expect(
      ensureRefineSkill(tempDir, nonExistentBundledPath),
    ).rejects.toThrow()
  })

  it('does not overwrite existing user-customized skill file', async () => {
    const skillDir = path.join(tempDir, 'skills', 'refine')
    await fs.mkdir(skillDir, { recursive: true })
    const customizedContent = '# My Custom Refine Skill\nCustom instructions'
    const targetPath = path.join(skillDir, 'SKILL.md')
    await fs.writeFile(targetPath, customizedContent, 'utf8')

    const returnedPath = await ensureRefineSkill(tempDir)
    expect(returnedPath).toBe(targetPath)

    const currentContent = await fs.readFile(targetPath, 'utf8')
    expect(currentContent).toBe(customizedContent)
  })

  it('supports custom bundledSkillPath override', async () => {
    const customBundled = path.join(tempDir, 'custom-source-skill.md')
    await fs.writeFile(customBundled, '# Custom Source Skill Content', 'utf8')

    const targetHome = path.join(tempDir, 'home')
    const targetFile = await ensureRefineSkill(targetHome, customBundled)

    const content = await fs.readFile(targetFile, 'utf8')
    expect(content).toBe('# Custom Source Skill Content')
  })
})
