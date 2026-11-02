import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../../store/project-store.js'
import ProjectInfo from './info.js'

describe('project info command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string

  beforeEach(async () => {
    process.exitCode = 0
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-info-cmd-projects-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-info-cmd-workdir-'))
  })

  afterEach(async () => {
    process.exitCode = 0
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  it('renders project details cleanly without [OK] badge when directory is registered', async () => {
    await initProject({
      name: 'Test Project',
      description: 'Useful description',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectInfo
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Test Project')
      expect(frame).toContain('test-project')
      expect(frame).toContain('Useful description')
      expect(frame).toContain(path.resolve(tempWorkDir))
      expect(frame).toContain('Name:')
      expect(frame).toContain('Slug:')
      expect(frame).toContain('Description:')
      expect(frame).toContain('Path:')
      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain(chalk.green('[OK]'))
    })
  })

  it('outputs valid JSON when --format=json is passed', async () => {
    await initProject({
      name: 'JSON Project',
      description: 'Details for JSON',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectInfo
        cwd={tempWorkDir}
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toEqual({
        slug: 'json-project',
        name: 'JSON Project',
        description: 'Details for JSON',
        path: path.resolve(tempWorkDir),
      })
      expect(frame).not.toContain('[OK]')
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when directory is not initialized', async () => {
    const { lastFrame } = render(
      <ProjectInfo
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame.replace(/\s+/g, ' ')).toContain(
        `Current directory "${path.resolve(tempWorkDir)}" is not initialized as a project`,
      )
      expect(process.exitCode).toBe(1)
    })
  })
})
