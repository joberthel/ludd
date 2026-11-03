import type { ConfigSchema } from '../store/config-store.js'
import type { Store } from '../store/create-store.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as skillModule from '../refine/ensure-refine-skill.js'
import * as agySessionModule from '../refine/run-agy-session.js'
import { callCompleteRefinement, callGetInitialContext, initMcpSession } from '../refine/test-helpers.js'
import { createConfigStore, writeConfigKey } from '../store/config-store.js'
import { initProject } from '../store/project-store.js'
import { createTask } from '../store/task-store.js'
import { pressKey, stripAnsi, submitAndWait } from '../test-helpers.js'
import TaskRefine, { options } from './refine.js'

describe('task refine command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string
  let tempConfigDir: string
  let testConfigStore: Store<typeof ConfigSchema>
  let originalExitCode: number | undefined

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-refine-cmd-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-refine-cmd-work-'))
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-refine-cmd-cfg-'))
    testConfigStore = createConfigStore(path.join(tempConfigDir, 'config.json'))
    originalExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
    await rm(tempConfigDir, { force: true, recursive: true })
  })

  it('does not expose --effort in options schema', () => {
    expect('effort' in options.shape).toBe(false)
    expect('model' in options.shape).toBe(true)
  })

  it('renders [ERROR] and sets process.exitCode = 1 when directory is not initialized', async () => {
    const { lastFrame } = render(
      <TaskRefine
        configStore={testConfigStore}
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

  it('renders [ERROR] and sets process.exitCode = 1 when specified task does not exist', async () => {
    await initProject({
      name: 'Non Existent Task Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['42']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Task #42 does not exist')
      expect(process.exitCode).toBe(1)
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when task is not in refinement status', async () => {
    const { slug } = await initProject({
      name: 'Wrong Status Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Already Todo Task',
      status: 'todo',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Task #1 has status "todo" (expected "refinement")')
      expect(process.exitCode).toBe(1)
    })
  })

  it('transitions to running state when task is in refinement status', async () => {
    const { slug } = await initProject({
      name: 'Valid Refine Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Refine Me',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async () => new Promise(() => {})}
      />,
    )

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('Refining Task #1: Refine Me')
      expect(frame).toContain('Model: gemini-4-argon-medium')
    })
  })

  it('respects --model CLI override', async () => {
    const { slug } = await initProject({
      name: 'Override Flags Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Refine Me Flagged',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        options={{
          model: 'claude-3-7-sonnet',
        }}
        projectsDir={tempProjectsDir}
        runSession={async () => new Promise(() => {})}
      />,
    )

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('Refining Task #1: Refine Me Flagged')
      expect(frame).toContain('Model: claude-3-7-sonnet')
    })
  })

  it('reads default model from configStore', async () => {
    await writeConfigKey(testConfigStore, 'refine.model', 'Custom Argon Pro')

    const { slug } = await initProject({
      name: 'Custom Config Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Custom Config Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async () => new Promise(() => {})}
      />,
    )

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('Refining Task #1: Custom Config Task')
      expect(frame).toContain('Model: Custom Argon Pro')
    })
  })

  it('renders "No tasks in refinement status." when no refinement tasks exist and ID is omitted', async () => {
    const { slug } = await initProject({
      name: 'No Refine Tasks Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Already Done Task',
      status: 'done',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No tasks in refinement status.')
      expect(process.exitCode).toBeUndefined()
    })
  })

  it('opens Select of refinement tasks and starts session upon selection', async () => {
    const { slug } = await initProject({
      name: 'Interactive Select Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'First Refinement Task',
      status: 'refinement',
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Second Refinement Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRefine
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async () => new Promise(() => {})}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select task to refine:')
      expect(frame).toContain('#1 First Refinement Task')
      expect(frame).toContain('#2 Second Refinement Task')
    })

    // Press Enter to select the focused option (task #1)
    await submitAndWait(stdin, '\r', () => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('Refining Task #1: First Refinement Task')
      expect(frame).toContain('Model: gemini-4-argon-medium')
    })
  })

  it('opens Select of refinement tasks when ID is blank or whitespace', async () => {
    const { slug } = await initProject({
      name: 'Blank ID Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Whitespace ID Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <TaskRefine
        args={['   ']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select task to refine:')
      expect(frame).toContain('#1 Whitespace ID Task')
    })
  })

  it('uses ensureRefineSkill and runAgyRefineSession by default when runSession is not provided', async () => {
    const customLuddHome = path.join(tempConfigDir, 'custom-ludd-home')
    const { slug } = await initProject({
      name: 'Default Runner Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Default Runner Task',
      status: 'refinement',
    }, tempProjectsDir)

    let sessionCalled = false
    const runAgySpy = vi.spyOn(agySessionModule, 'runAgyRefineSession').mockImplementation(async (options) => {
      sessionCalled = true
      const sessionId = await initMcpSession(options.mcpServer.url)
      await callGetInitialContext(options.mcpServer.url, {}, sessionId)
      await callCompleteRefinement(
        options.mcpServer.url,
        {
          outcome: 'Default runner outcome',
          user: 'Developers',
          whyNow: 'Now',
          success: 'Tests pass',
          constraint: 'None',
          outOfScope: 'Nothing',
        },
        sessionId,
      )
    })

    const ensureSkillSpy = vi.spyOn(skillModule, 'ensureRefineSkill').mockResolvedValue('/fake/skill/path')

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        luddHomeDir={customLuddHome}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })

    await pressKey(stdin, 'Build default runner feature')
    await pressKey(stdin, '\r')

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(lastFrame() ?? '').toContain('[OK]')
    })

    expect(ensureSkillSpy).toHaveBeenCalledWith(customLuddHome)
    expect(runAgySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        luddHomeDir: customLuddHome,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(sessionCalled).toBe(true)

    runAgySpy.mockRestore()
    ensureSkillSpy.mockRestore()
  })

  it('unmounts alternate screen and prints final [OK] summary when session completes', async () => {
    const { slug } = await initProject({
      name: 'Clean Exit Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: slug,
      name: 'Clean Exit Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          await callCompleteRefinement(
            mcpServer.url,
            {
              outcome: 'Exit outcome',
              user: 'Developers',
              whyNow: 'Now',
              success: 'All clear',
              constraint: 'None',
              outOfScope: 'None',
            },
            sessionId,
          )
        }}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })

    await pressKey(stdin, 'Clean exit test initial input')
    await pressKey(stdin, '\r')

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain(`Refinement completed for task #${task.id} (${task.name})`)
    })
  })
})
