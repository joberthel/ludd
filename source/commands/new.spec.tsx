import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../store/project-store.js'
import TaskNew from './new.js'

describe('task new command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string
  let originalExitCode: number | undefined

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-new-cmd-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-new-cmd-work-'))
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
      <TaskNew
        cwd={tempWorkDir}
        options={{ name: 'Some Task' }}
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

  it('creates task non-interactively when name and branch are provided', async () => {
    const initResult = await initProject({
      name: 'Test Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskNew
        cwd={tempWorkDir}
        options={{ branch: 'custom-feat', name: 'Add Auth' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Created task #1 (Add Auth) on branch custom-feat')
    })

    const taskFile = path.join(tempProjectsDir, initResult.slug, 'tasks', '1', 'task.json')
    const content = JSON.parse(await readFile(taskFile, 'utf8'))
    expect(content).toEqual({
      id: 1,
      name: 'Add Auth',
      branch: 'custom-feat',
      status: 'refinement',
    })
  })

  it('prompts interactively for name and accepts slugified branch on Enter', async () => {
    const initResult = await initProject({
      name: 'Interactive Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskNew
        cwd={tempWorkDir}
        options={{}}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Task name:')
    })

    stdin.write('Interactive Task')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Interactive Task')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Branch name:')
    })

    // Press Enter to accept slugified branch default
    await new Promise(resolve => setTimeout(resolve, 50))
    await vi.waitFor(() => {
      stdin.write('\r')
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Created task #1 (Interactive Task) on branch interactive-task')
    })

    const taskFile = path.join(tempProjectsDir, initResult.slug, 'tasks', '1', 'task.json')
    const content = JSON.parse(await readFile(taskFile, 'utf8'))
    expect(content.branch).toBe('interactive-task')
  })

  it('prompts for branch when name is passed via options', async () => {
    await initProject({
      name: 'Branch Prompt Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskNew
        cwd={tempWorkDir}
        options={{ name: 'Named Task' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Task name:')
      expect(frame).toContain('Named Task')
      expect(frame).toContain('Branch name:')
    })

    stdin.write('my-override-branch')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('my-override-branch')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Created task #1 (Named Task) on branch my-override-branch')
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when empty name is submitted interactively', async () => {
    await initProject({
      name: 'Error Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskNew
        cwd={tempWorkDir}
        options={{}}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Task name:')
    })

    stdin.write('   ')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('   ')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Task name cannot be empty')
      expect(process.exitCode).toBe(1)
    })
  })
})
