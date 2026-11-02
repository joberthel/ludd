import type { ConfigSchema } from '../store/config-store.js'
import type { Store } from '../store/create-store.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callAskQuestion, callCompleteRefinement, initMcpSession } from '../refine/test-helpers.js'
import { createConfigStore, writeConfigKey } from '../store/config-store.js'
import { initProject } from '../store/project-store.js'
import { createTask, getTask } from '../store/task-store.js'
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
        runSession={async () => new Promise(() => {})}
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
        runSession={async () => new Promise(() => {})}
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
        runSession={async () => new Promise(() => {})}
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
          const sessionId = await initMcpSession(mcpServer.url)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'User wants dark mode by default',
              confidence: 65,
              missing: 'persistence strategy',
              question: 'Should dark mode be persisted in localStorage?',
              guess: 'Yes, persist in localStorage',
            },
            sessionId,
          )
          sessionPromiseResolve()
          // keep running
          await new Promise(() => {})
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

    expect(toolResult).toMatchObject({
      jsonrpc: '2.0',
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
          const sessionId = await initMcpSession(mcpServer.url)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'User wants cookies',
              confidence: 85,
              question: 'Use cookies or indexedDB?',
              guess: 'Cookies',
            },
            sessionId,
          )
          sessionPromiseResolve()
          // keep running
          await new Promise(() => {})
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

    expect(toolResult).toMatchObject({
      jsonrpc: '2.0',
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

  it('rejects a second ask_question call with an error while one is pending', async () => {
    const { slug } = await initProject({
      name: 'Concurrent Questions Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Concurrent Task',
      status: 'refinement',
    }, tempProjectsDir)

    let secondCallResult: unknown
    let firstCallResult: unknown

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)

          // Fire first question (will wait for user)
          const firstPromise = callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'First question',
              confidence: 90,
              question: 'First question text',
              guess: 'First guess',
            },
            sessionId,
          )

          // Small delay so first question reaches UI
          await new Promise(r => setTimeout(r, 50))

          // Fire second question concurrently
          secondCallResult = await callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'Second question',
              confidence: 80,
              question: 'Second question text',
              guess: 'Second guess',
            },
            sessionId,
          )

          firstCallResult = await firstPromise
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('First question text')
    })

    // Second call must have been rejected as a tool error
    await vi.waitFor(() => {
      expect(secondCallResult).toBeDefined()
    })

    const secondParsed = secondCallResult as { result: { isError: boolean, content: Array<{ text: string }> } }
    expect(secondParsed.result?.isError).toBe(true)
    expect(secondParsed.result?.content[0]?.text).toContain('Only one question may be asked at a time')

    // First question should still be answerable
    stdin.write('\r')

    await vi.waitFor(() => {
      expect(firstCallResult).toBeDefined()
    })

    const firstParsed = firstCallResult as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(firstParsed.result.content[0]!.text)).toEqual({ answer: 'First guess' })
  })

  it('unmount cleanup rejects pending question and closes server without hanging', async () => {
    const { slug } = await initProject({
      name: 'Unmount Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Unmount Task',
      status: 'refinement',
    }, tempProjectsDir)

    let _questionError: unknown
    let serverPort: number | undefined

    const { unmount } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          serverPort = mcpServer.port
          const sessionId = await initMcpSession(mcpServer.url)
          try {
            await callAskQuestion(
              mcpServer.url,
              {
                hypothesis: 'Unmount test',
                confidence: 90,
                question: 'Will unmount soon?',
                guess: 'Yes',
              },
              sessionId,
            )
          }
          catch (e) {
            _questionError = e
          }
        }}
      />,
    )

    await vi.waitFor(() => {
      expect(serverPort).toBeDefined()
    })

    // Give it a moment to enter askingQuestion state
    await new Promise(r => setTimeout(r, 50))

    // Unmount while question is pending
    unmount()

    // Server should close connections promptly and port should no longer accept connections
    await vi.waitFor(async () => {
      let isClosed = false
      try {
        await fetch(`http://127.0.0.1:${serverPort}/mcp`, { method: 'POST' })
      }
      catch {
        isClosed = true
      }
      expect(isClosed).toBe(true)
    })
  })

  it('transitions to done state and closes server when runSession completes after refinement confirmation', async () => {
    const { slug } = await initProject({
      name: 'Done State Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Done Task',
      status: 'refinement',
    }, tempProjectsDir)

    let serverPort: number | undefined

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          serverPort = mcpServer.port
          const sessionId = await initMcpSession(mcpServer.url)
          await callCompleteRefinement(
            mcpServer.url,
            {
              outcome: 'Done outcome',
              user: 'Done user',
              whyNow: 'Done why now',
              success: 'Done success',
              constraint: 'Done constraint',
              outOfScope: 'Done out of scope',
            },
            sessionId,
          )
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Refinement completed for task #1 (Done Task)')
    })

    // Server should be closed after runSession resolves
    await vi.waitFor(async () => {
      let isClosed = false
      try {
        await fetch(`http://127.0.0.1:${serverPort}/mcp`, { method: 'POST' })
      }
      catch {
        isClosed = true
      }
      expect(isClosed).toBe(true)
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when runSession finishes without confirming refinement', async () => {
    const { slug } = await initProject({
      name: 'Unconfirmed Exit Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Unconfirmed Task',
      status: 'refinement',
    }, tempProjectsDir)

    let serverPort: number | undefined

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          serverPort = mcpServer.port
          // Agent session finishes without calling complete_refinement
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Refinement session ended before task refinement was completed')
      expect(process.exitCode).toBe(1)
    })

    await vi.waitFor(async () => {
      let isClosed = false
      try {
        await fetch(`http://127.0.0.1:${serverPort}/mcp`, { method: 'POST' })
      }
      catch {
        isClosed = true
      }
      expect(isClosed).toBe(true)
    })
  })

  it('renders [ERROR], sets process.exitCode = 1, and closes server when runSession throws', async () => {
    const { slug } = await initProject({
      name: 'Error Session Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Failed Task',
      status: 'refinement',
    }, tempProjectsDir)

    let serverPort: number | undefined

    const { lastFrame } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          serverPort = mcpServer.port
          throw new Error('Agent process exited unexpectedly with code 1')
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Agent process exited unexpectedly with code 1')
      expect(process.exitCode).toBe(1)
    })

    // Server should be closed after runSession fails
    await vi.waitFor(async () => {
      let isClosed = false
      try {
        await fetch(`http://127.0.0.1:${serverPort}/mcp`, { method: 'POST' })
      }
      catch {
        isClosed = true
      }
      expect(isClosed).toBe(true)
    })
  })

  it('handles complete_refinement feedback loop and final confirmation with Enter, writing intent.md and setting task to todo', async () => {
    const { slug } = await initProject({
      name: 'Refinement Complete Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Interactive Refinement Task',
      status: 'refinement',
    }, tempProjectsDir)

    let feedbackResult: unknown
    let confirmResult: unknown

    const initialIntent = {
      outcome: 'Draft outcome',
      user: 'Draft user',
      whyNow: 'Draft why now',
      success: 'Draft success',
      constraint: 'Draft constraint',
      outOfScope: 'Draft out of scope',
    }

    const refinedIntent = {
      outcome: 'Refined outcome with offline support',
      user: 'All mobile and desktop users',
      whyNow: 'High demand from customers',
      success: 'Intent written and status set to todo',
      constraint: 'No native binaries',
      outOfScope: 'Cloud sync',
    }

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)

          // 1. Send first complete_refinement tool call
          feedbackResult = await callCompleteRefinement(
            mcpServer.url,
            initialIntent,
            sessionId,
          )

          // 2. Send second complete_refinement tool call with refined intent
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            refinedIntent,
            sessionId,
          )
        }}
      />,
    )

    // Wait for statement of intent to render in the TUI
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
      expect(frame).toContain('Draft outcome')
      expect(frame).toContain('Draft user')
      expect(frame).toContain('Draft why now')
      expect(frame).toContain('Draft success')
      expect(frame).toContain('Draft constraint')
      expect(frame).toContain('Draft out of scope')
      expect(frame).toContain('Confirm intent? (Enter/y to confirm, or type refinement feedback):')
    })

    // User types refinement feedback
    stdin.write('Needs offline support')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Needs offline support')
    })
    stdin.write('\r')

    // Feedback tool call should resolve with confirmed: false and the user feedback
    await vi.waitFor(() => {
      expect(feedbackResult).toBeDefined()
    })
    const feedbackParsed = feedbackResult as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(feedbackParsed.result.content[0]!.text)).toEqual({
      confirmed: false,
      feedback: 'Needs offline support',
    })

    // Task must still be refinement, and intent.md must not exist yet
    const taskDuringFeedback = await getTask(slug, 1, tempProjectsDir)
    expect(taskDuringFeedback.status).toBe('refinement')
    const intentPath = path.join(tempProjectsDir, slug, 'tasks', '1', 'intent.md')
    await expect(readFile(intentPath)).rejects.toThrow()

    // Wait for second candidate intent to be displayed
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Refined outcome with offline support')
    })

    // User presses Enter to confirm intent
    stdin.write('\r')

    // Confirm call should resolve with confirmed: true
    await vi.waitFor(() => {
      expect(confirmResult).toBeDefined()
    })
    const confirmParsed = confirmResult as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(confirmParsed.result.content[0]!.text)).toEqual({
      confirmed: true,
    })

    // Verify [OK] is rendered in TUI
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Refinement completed for task #1 (Interactive Refinement Task)')
    })

    // Verify task status is now todo
    const taskAfterConfirm = await getTask(slug, 1, tempProjectsDir)
    expect(taskAfterConfirm.status).toBe('todo')

    // Verify intent.md was written with expected markdown content
    const savedMarkdown = await readFile(intentPath, 'utf-8')
    expect(savedMarkdown).toContain('# Statement of Intent: Interactive Refinement Task (#1)')
    expect(savedMarkdown).toContain('- **Outcome:** Refined outcome with offline support')
    expect(savedMarkdown).toContain('- **User:** All mobile and desktop users')
    expect(savedMarkdown).toContain('- **Why now:** High demand from customers')
    expect(savedMarkdown).toContain('- **Success:** Intent written and status set to todo')
    expect(savedMarkdown).toContain('- **Constraint:** No native binaries')
    expect(savedMarkdown).toContain('- **Out of scope:** Cloud sync')
  })

  it('accepts "y" to confirm intent during complete_refinement', async () => {
    const { slug } = await initProject({
      name: 'Y Confirm Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Y Confirm Task',
      status: 'refinement',
    }, tempProjectsDir)

    let confirmResult: unknown

    const intent = {
      outcome: 'Outcome',
      user: 'Users',
      whyNow: 'Now',
      success: 'Success condition',
      constraint: 'Constraint',
      outOfScope: 'Out of scope',
    }

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    // Confirm with "y"
    stdin.write('y')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('y')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
      expect(confirmResult).toBeDefined()
    })
    const confirmParsed = confirmResult as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(confirmParsed.result.content[0]!.text)).toEqual({
      confirmed: true,
    })

    const task = await getTask(slug, 1, tempProjectsDir)
    expect(task.status).toBe('todo')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
    })
  })

  it('accepts literal "yes" (case-insensitive) to confirm intent during complete_refinement', async () => {
    const { slug } = await initProject({
      name: 'Yes Confirm Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Yes Confirm Task',
      status: 'refinement',
    }, tempProjectsDir)

    let confirmResult: unknown

    const intent = {
      outcome: 'Outcome Yes',
      user: 'Users Yes',
      whyNow: 'Now Yes',
      success: 'Success condition',
      constraint: 'Constraint',
      outOfScope: 'Out of scope',
    }

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    // Confirm with "YES"
    stdin.write('YES')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('YES')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
      expect(confirmResult).toBeDefined()
    })
    const confirmParsed = confirmResult as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(confirmParsed.result.content[0]!.text)).toEqual({
      confirmed: true,
    })

    const task = await getTask(slug, 1, tempProjectsDir)
    expect(task.status).toBe('todo')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
    })
  })

  it('renders [ERROR], sets process.exitCode = 1, and rejects tool call when completeTaskRefinement fails during onConfirm', async () => {
    const { slug } = await initProject({
      name: 'Fail Confirm Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    await createTask({
      projectSlug: slug,
      name: 'Fail Confirm Task',
      status: 'refinement',
    }, tempProjectsDir)

    let confirmResult: unknown

    const intent = {
      outcome: 'Fail outcome',
      user: 'Users',
      whyNow: 'Now',
      success: 'Success',
      constraint: 'Constraint',
      outOfScope: 'Out of scope',
    }

    const { lastFrame, stdin } = render(
      <TaskRefine
        args={['1']}
        configStore={testConfigStore}
        cwd={tempWorkDir}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    // Corrupt task.json while awaiting user confirmation to cause completeTaskRefinement to fail
    const taskJsonPath = path.join(tempProjectsDir, slug, 'tasks', '1', 'task.json')
    await rm(taskJsonPath, { force: true })

    // User submits confirmation
    stdin.write('\r')

    await vi.waitFor(() => {
      expect(confirmResult).toBeDefined()
    })

    const parsed = confirmResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsed.result?.isError).toBe(true)
    expect(parsed.result?.content?.[0]?.text).toContain('corrupt (missing task.json)')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('corrupt (missing task.json)')
      expect(process.exitCode).toBe(1)
    })
  })
})
