import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../store/project-store.js'
import { createTask, listTasks } from '../store/task-store.js'
import TaskRm from './rm.js'

describe('task rm command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string
  let originalExitCode: number | undefined

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rm-cmd-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-rm-cmd-work-'))
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
      <TaskRm
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

  it('renders [ERROR] and sets process.exitCode = 1 when combining positional IDs and --all', async () => {
    await initProject({
      name: 'Conflict Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
        args={['1']}
        cwd={tempWorkDir}
        options={{ all: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Cannot specify both task IDs and --all')
      expect(process.exitCode).toBe(1)
    })
  })

  it('renders "No tasks found." when --all is passed and project has no tasks', async () => {
    await initProject({
      name: 'Empty Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
        cwd={tempWorkDir}
        options={{ all: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No tasks found.')
      expect(frame).not.toContain('[OK]')
    })
  })

  it('renders "No tasks found." when interactive with no tasks', async () => {
    await initProject({
      name: 'Empty Project Interactive',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
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

  it('removes specific tasks with positional IDs without prompt when --force is passed', async () => {
    const { slug } = await initProject({
      name: 'Force Positional',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
    await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)
    await createTask({ projectSlug: slug, name: 'Task 3' }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
        args={['1', '#3']}
        cwd={tempWorkDir}
        options={{ force: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed 2 task(s): #1, #3')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining.map(t => t.id)).toEqual([2])
  })

  it('removes single task with confirmation when confirmed with y', async () => {
    const { slug } = await initProject({
      name: 'Single Confirm',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRm
        args={['#1']}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Remove task #1?')
    })

    stdin.write('y')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed task #1')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining).toEqual([])
  })

  it('cancels removal and leaves tasks intact when n is pressed at confirmation', async () => {
    const { slug } = await initProject({
      name: 'Cancel Rm',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRm
        args={['1']}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Remove task #1?')
    })

    stdin.write('n')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removal cancelled.')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining).toHaveLength(1)
  })

  it('renders [ERROR] and sets process.exitCode = 1 when target task ID does not exist', async () => {
    const { slug } = await initProject({
      name: 'Missing Task Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
        args={['99']}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain(`Task #99 does not exist in project "${slug}"`)
      expect(process.exitCode).toBe(1)
    })
  })

  it('removes all tasks when --all and --force are passed', async () => {
    const { slug } = await initProject({
      name: 'All Force Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
    await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRm
        cwd={tempWorkDir}
        options={{ all: true, force: true }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed 2 task(s): #1, #2')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining).toEqual([])
  })

  it('supports selecting tasks interactively via MultiSelect and confirming with y', async () => {
    const { slug } = await initProject({
      name: 'MultiSelect Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task A' }, tempProjectsDir)
    await createTask({ projectSlug: slug, name: 'Task B' }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRm
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select task(s) to remove')
      expect(frame).toContain('#1 Task A')
    })

    // Toggle Task 1 with Space
    stdin.write(' ')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('✔')
    })

    // Submit selection
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Remove task #1?')
    })

    // Confirm with y
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.write('y')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Removed task #1')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining.map(t => t.id)).toEqual([2])
  })

  it('renders "No tasks selected for removal." when submitting empty selection in MultiSelect', async () => {
    const { slug } = await initProject({
      name: 'Empty Select Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRm
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select task(s) to remove')
    })

    // Submit without selecting anything
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('No tasks selected for removal.')
    })

    const remaining = await listTasks(slug, tempProjectsDir)
    expect(remaining).toHaveLength(1)
  })
})
