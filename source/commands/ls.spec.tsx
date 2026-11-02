import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../store/project-store.js'
import { createTask } from '../store/task-store.js'
import TaskLs from './ls.js'

describe('task ls command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string
  let originalExitCode: number | undefined

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ls-cmd-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-ls-cmd-work-'))
    originalExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when directory is not initialized', async () => {
    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame.replace(/\s+/g, ' ')).toContain('is not initialized as a project')
      expect(process.exitCode).toBe(1)
    })
  })

  it('renders "No tasks found." when project has no tasks', async () => {
    await initProject({
      name: 'Empty Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No tasks found.')
      expect(frame).not.toContain('[OK]')
    })
  })

  it('renders table headers and rows without [OK] badge when tasks exist', async () => {
    const { slug } = await initProject({
      name: 'Tasks Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'First Task',
      branch: 'first-task-branch',
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Second Task',
      branch: 'second-task-branch',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('ID')
      expect(frame).toContain('NAME')
      expect(frame).toContain('BRANCH')
      expect(frame).toContain('STATUS')
      expect(frame).toContain('#1')
      expect(frame).toContain('First Task')
      expect(frame).toContain('first-task-branch')
      expect(frame).toContain('#2')
      expect(frame).toContain('Second Task')
      expect(frame).toContain('second-task-branch')
      expect(frame).toContain('refinement')
      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain('[RUNNING]')
    })
  })

  it('outputs valid JSON array when --format=json is passed', async () => {
    const { slug } = await initProject({
      name: 'Json Tasks Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'JSON Task',
      branch: 'json-branch',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toEqual([
        {
          id: 1,
          name: 'JSON Task',
          branch: 'json-branch',
          status: 'refinement',
        },
      ])
      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain('[RUNNING]')
    })
  })

  it('outputs empty JSON array [] when --format=json is passed and no tasks exist', async () => {
    await initProject({
      name: 'Empty Json Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toEqual([])
      expect(frame).not.toContain('[OK]')
      expect(frame).not.toContain('[RUNNING]')
    })
  })

  it('outputs valid JSON without terminal line wrapping corruption for long values (>120 chars)', async () => {
    const { slug } = await initProject({
      name: 'Long Task Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const longName = 'a'.repeat(120)
    await createTask({
      projectSlug: slug,
      name: longName,
      branch: 'long-task-branch',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskLs
        cwd={tempWorkDir}
        options={{ format: 'json' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      const parsed = JSON.parse(frame)
      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.name).toBe(longName)
    })
  })
})
