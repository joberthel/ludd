import type { ConfigSchema } from '../store/config-store.js'
import type { Store } from '../store/create-store.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigStore, writeConfigKey } from '../store/config-store.js'
import { initProject } from '../store/project-store.js'
import { createTask } from '../store/task-store.js'
import TaskRefine from './refine.js'

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
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (Refine Me) with Gemini 4 Argon (effort: medium)...')
    })
  })

  it('respects --model and --effort CLI overrides', async () => {
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
          model: 'Claude 3.7 Sonnet',
          effort: 'high',
        }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (Refine Me Flagged) with Claude 3.7 Sonnet (effort: high)...')
    })
  })

  it('reads default model and effort from configStore', async () => {
    await writeConfigKey(testConfigStore, 'refine.model', 'Custom Argon Pro')
    await writeConfigKey(testConfigStore, 'refine.effort', 'xhigh')

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
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (Custom Config Task) with Custom Argon Pro (effort: xhigh)...')
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
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Select task to refine:')
      expect(frame).toContain('#1 First Refinement Task')
      expect(frame).toContain('#2 Second Refinement Task')
    })

    // Press Enter to select the focused option (task #1)
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (First Refinement Task) with Gemini 4 Argon (effort: medium)...')
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

  it('renders ask_question prompt and returns guess when pressing Enter on empty input', async () => {
    const { slug } = await initProject({
      name: 'Ask Question Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Refine Task For Question',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let sessionPromiseResolve: () => void
    const sessionPromise = new Promise<void>((resolve) => {
      sessionPromiseResolve = resolve
    })

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const initRes = await fetch(mcpServer.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-agent', version: '1.0.0' },
              },
            }),
          })
          const sessionId = initRes.headers.get('mcp-session-id')
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
          }
          if (sessionId !== null && sessionId !== '') {
            headers['mcp-session-id'] = sessionId
          }

          const callRes = await fetch(mcpServer.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'ask_question',
                arguments: {
                  hypothesis: 'User wants dark mode by default',
                  confidence: 65,
                  missing: 'persistence strategy',
                  question: 'Should dark mode be persisted in localStorage?',
                  guess: 'Yes, persist in localStorage',
                },
              },
            }),
          })
          toolResult = await callRes.json()
          sessionPromiseResolve()
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('HYPOTHESIS:')
      expect(frame).toContain('User wants dark mode by default')
      expect(frame).toContain('CONFIDENCE:')
      expect(frame).toContain('65%')
      expect(frame).toContain('MISSING:')
      expect(frame).toContain('persistence strategy')
      expect(frame).toContain('Q:')
      expect(frame).toContain('Should dark mode be persisted in localStorage?')
      expect(frame).toContain('GUESS:')
      expect(frame).toContain('Yes, persist in localStorage')
      expect(frame).toContain('Answer (press Enter to accept guess):')
    })

    stdin.write('\r')

    await sessionPromise

    expect(toolResult).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ answer: 'Yes, persist in localStorage' }),
          },
        ],
      },
    })

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (Refine Task For Question)')
    })
  })

  it('renders ask_question prompt and returns typed trimmed answer', async () => {
    const { slug } = await initProject({
      name: 'Custom Answer Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Refine Task Custom Answer',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let sessionPromiseResolve: () => void
    const sessionPromise = new Promise<void>((resolve) => {
      sessionPromiseResolve = resolve
    })

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const initRes = await fetch(mcpServer.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-agent', version: '1.0.0' },
              },
            }),
          })
          const sessionId = initRes.headers.get('mcp-session-id')
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
          }
          if (sessionId !== null && sessionId !== '') {
            headers['mcp-session-id'] = sessionId
          }

          const callRes = await fetch(mcpServer.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'ask_question',
                arguments: {
                  hypothesis: 'User wants cookies',
                  confidence: 85,
                  question: 'Use cookies or indexedDB?',
                  guess: 'Cookies',
                },
              },
            }),
          })
          toolResult = await callRes.json()
          sessionPromiseResolve()
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('HYPOTHESIS:')
      expect(frame).toContain('User wants cookies')
      expect(frame).toContain('CONFIDENCE:')
      expect(frame).toContain('85%')
      expect(frame).not.toContain('MISSING:')
      expect(frame).toContain('Q:')
      expect(frame).toContain('Use cookies or indexedDB?')
      expect(frame).toContain('GUESS:')
      expect(frame).toContain('Cookies')
    })

    stdin.write('No, use indexedDB instead')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('No, use indexedDB instead')
    })
    stdin.write('\r')

    await sessionPromise

    expect(toolResult).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ answer: 'No, use indexedDB instead' }),
          },
        ],
      },
    })

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.yellow('[RUNNING]'))
      expect(frame).toContain('Refining task #1 (Refine Task Custom Answer)')
    })
  })
})
