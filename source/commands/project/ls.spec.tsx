import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../../store/project-store.js'
import ProjectLs from './ls.js'

describe('project ls command', () => {
  let tempProjectsDir: string

  beforeEach(async () => {
    process.exitCode = 0
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ls-cmd-projects-'))
  })

  afterEach(async () => {
    process.exitCode = 0
    await rm(tempProjectsDir, { force: true, recursive: true })
  })

  it('renders "No projects found." when no projects are registered', async () => {
    const { lastFrame } = render(
      <ProjectLs
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No projects found.')
      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain('[RUNNING]')
    })
  })

  it('renders table headers and rows without [OK] badge when projects exist', async () => {
    await initProject({
      name: 'Project Alpha',
      description: 'Alpha description',
      path: '/workspace/alpha',
    }, tempProjectsDir)

    await initProject({
      name: 'Project Beta',
      description: 'Beta description',
      path: '/workspace/beta',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectLs
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('NAME')
      expect(frame).toContain('SLUG')
      expect(frame).toContain('DESCRIPTION')
      expect(frame).toContain('PATH')

      expect(frame).toContain('Project Alpha')
      expect(frame).toContain('project-alpha')
      expect(frame).toContain('Alpha description')
      expect(frame).toContain('/workspace/alpha')

      expect(frame).toContain('Project Beta')
      expect(frame).toContain('project-beta')
      expect(frame).toContain('Beta description')
      expect(frame).toContain('/workspace/beta')

      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain(chalk.green('[OK]'))
    })
  })

  it('outputs valid JSON array when --format=json is passed', async () => {
    await initProject({
      name: 'Alpha',
      description: 'Alpha desc',
      path: '/workspace/alpha',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectLs
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toEqual([
        {
          slug: 'alpha',
          name: 'Alpha',
          description: 'Alpha desc',
          path: '/workspace/alpha',
        },
      ])
      expect(frame).not.toContain('[OK]')
    })
  })

  it('outputs empty JSON array [] when --format=json is passed and no projects exist', async () => {
    const { lastFrame } = render(
      <ProjectLs
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toEqual([])
      expect(frame).not.toContain('[OK]')
    })
  })

  it('renders table properly with wide CJK and emoji project names', async () => {
    await initProject({
      name: '🚀 Project 项目',
      description: 'Emoji and CJK',
      path: '/workspace/wide',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectLs
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('🚀 Project 项目')
      expect(frame).toContain('/workspace/wide')
    })
  })
})
