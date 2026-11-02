import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject, listProjects } from '../../store/project-store.js'
import ProjectRm from './rm.js'

describe('project rm command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string

  beforeEach(async () => {
    process.exitCode = 0
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rm-cmd-projects-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rm-cmd-workdir-'))
  })

  afterEach(async () => {
    process.exitCode = 0
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  it('renders "No projects found." when no projects are registered and --current is not set', async () => {
    const { lastFrame } = render(
      <ProjectRm
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No projects found.')
      expect(frame).not.toContain('[OK]')
      expect(process.exitCode).toBe(0)
    })
  })

  it('outputs error when --current is set but directory is not initialized', async () => {
    const { lastFrame } = render(
      <ProjectRm
        cwd={tempWorkDir}
        options={{ current: true, force: false }}
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

  it('removes current project immediately without prompt when --current and --force are passed', async () => {
    await writeFile(path.join(tempWorkDir, 'keep-me.txt'), 'keep me')

    const initResult = await initProject({
      name: 'Current To Remove',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectRm
        cwd={tempWorkDir}
        options={{ current: true, force: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain(`Removed project ${initResult.slug}`)
    })

    // Project metadata in tempProjectsDir should be deleted
    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toEqual([])

    // Source files in tempWorkDir must remain untouched
    const content = await readFile(path.join(tempWorkDir, 'keep-me.txt'), 'utf8')
    expect(content).toBe('keep me')
  })

  it('prompts confirmation and removes current project when confirmed with y', async () => {
    const initResult = await initProject({
      name: 'Confirm Current',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <ProjectRm
        cwd={tempWorkDir}
        options={{ current: true, force: false }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(`Remove project "${initResult.slug}"?`)
    })

    stdin.write('y')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain(`Removed project ${initResult.slug}`)
    })

    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toEqual([])
  })

  it('cancels removal and leaves project intact when n is pressed at confirmation', async () => {
    await initProject({
      name: 'Do Not Remove',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <ProjectRm
        cwd={tempWorkDir}
        options={{ current: true, force: false }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Remove project "do-not-remove"?')
    })

    stdin.write('n')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removal cancelled.')
    })

    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toHaveLength(1)
  })

  it('exits cleanly when user submits empty selection in multi-select', async () => {
    await initProject({
      name: 'Project 1',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <ProjectRm
        options={{ current: false, force: false }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select project(s) to remove')
    })

    // Submit without selecting anything
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('No projects selected for removal.')
    })

    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toHaveLength(1)
  })

  it('supports selecting projects, confirming, and removing multiple projects', async () => {
    const dirA = await mkdtemp(path.join(os.tmpdir(), 'rm-mult-a-'))
    const dirB = await mkdtemp(path.join(os.tmpdir(), 'rm-mult-b-'))

    await initProject({ name: 'Alpha', path: dirA }, tempProjectsDir)
    await initProject({ name: 'Beta', path: dirB }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <ProjectRm
        options={{ current: false, force: false }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select project(s) to remove')
      expect(frame).toContain('Alpha (alpha)')
    })

    // Select Alpha (first item) with Space
    stdin.write(' ')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('✔')
    })

    // Move down to Beta
    stdin.write('\u001B[B')

    // Wait a tick then toggle Beta with Space
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.write(' ')

    // Submit selection
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Remove')
    })

    // Confirm with y
    stdin.write('y')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed')
    })

    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toEqual([])

    await rm(dirA, { force: true, recursive: true })
    await rm(dirB, { force: true, recursive: true })
  })

  it('removes selected projects immediately without confirmation when --force is passed', async () => {
    const dirA = await mkdtemp(path.join(os.tmpdir(), 'rm-force-a-'))

    await initProject({ name: 'Alpha', path: dirA }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <ProjectRm
        options={{ current: false, force: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select project(s) to remove')
    })

    // Select Alpha with Space
    stdin.write(' ')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('✔')
    })

    // Submit selection
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed 1 project(s): alpha')
    })

    const remaining = await listProjects(tempProjectsDir)
    expect(remaining).toEqual([])

    await rm(dirA, { force: true, recursive: true })
  })
})
