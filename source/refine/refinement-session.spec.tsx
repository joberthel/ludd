import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../store/project-store.js'
import { createTask, getTask } from '../store/task-store.js'
import { pressKey, stripAnsi, submitAndWait } from '../test-helpers.js'
import { RefinementSession } from './refinement-session.js'
import {
  callAskQuestion,
  callCompleteRefinement,
  callGetInitialContext,
  initMcpSession,
} from './test-helpers.js'

describe('refinementSession component', () => {
  let tempProjectsDir: string
  let tempWorkDir: string
  let originalExitCode: number | undefined

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-refine-session-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-refine-session-work-'))
    originalExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  async function provideInitialContext(stdin: NodeJS.WriteStream, text = 'Initial user requirement') {
    await pressKey(stdin, text)
    await pressKey(stdin, '\r')
  }

  it('renders ask_question prompt and returns guess when pressing Enter on empty input', async () => {
    const project = await initProject({
      name: 'Ask Question Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Refine Task For Question',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let sessionPromiseResolve: () => void
    const sessionPromise = new Promise<void>((resolve) => {
      sessionPromiseResolve = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              confidence: 65,
              question: 'Should dark mode be persisted in localStorage?',
              guess: 'Yes, persist in localStorage',
            },
            sessionId,
          )
          sessionPromiseResolve()
          await new Promise(() => {})
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await pressKey(stdin, 'Initial user requirement')
    await pressKey(stdin, '\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).not.toContain('HYPOTHESIS:')
      expect(frame).not.toContain('MISSING:')
      expect(frame).toContain('Q:')
      expect(frame).toContain('Should dark mode be persisted in localStorage?')
      expect(frame).toContain('GUESS:')
      expect(frame).toContain('Yes, persist in localStorage')
      expect(frame).toContain('Answer (press Enter to accept guess):')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(toolResult).toBeDefined()
    })

    const parsed = toolResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsed.result?.content?.[0]?.text).toContain('Yes, persist in localStorage')
    await sessionPromise
  })

  it('renders ask_question prompt and returns typed trimmed answer', async () => {
    const project = await initProject({
      name: 'Custom Answer Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Custom Answer Task',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let sessionPromiseResolve: () => void
    const sessionPromise = new Promise<void>((resolve) => {
      sessionPromiseResolve = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              confidence: 80,
              question: 'Which framework should be used?',
              guess: 'React',
            },
            sessionId,
          )
          sessionPromiseResolve()
          await new Promise(() => {})
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Which framework should be used?')
    })

    await pressKey(stdin, 'Vue 3 instead')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Vue 3 instead')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(toolResult).toBeDefined()
    })

    const parsed = toolResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsed.result?.content?.[0]?.text).toContain('Vue 3 instead')
    await sessionPromise
  })

  it('rejects a second ask_question call with an error while one is pending', async () => {
    const project = await initProject({
      name: 'Concurrent Tool Call Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Concurrent Task',
      status: 'refinement',
    }, tempProjectsDir)

    let firstResult: unknown
    let secondResult: unknown

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          const firstCallPromise = callAskQuestion(
            mcpServer.url,
            {
              confidence: 50,
              question: 'First question?',
              guess: 'First guess',
            },
            sessionId,
          ).then((r) => {
            firstResult = r
          })

          await new Promise(r => setTimeout(r, 50))

          secondResult = await callAskQuestion(
            mcpServer.url,
            {
              confidence: 50,
              question: 'Second question?',
              guess: 'Second guess',
            },
            sessionId,
          )

          await firstCallPromise
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(secondResult).toBeDefined()
    })

    const parsedSecond = secondResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsedSecond.result?.isError).toBe(true)
    expect(parsedSecond.result?.content?.[0]?.text).toContain('Only one tool call may be awaiting user response at a time')

    await submitAndWait(stdin, '\r', () => {
      expect(firstResult).toBeDefined()
    })
    const parsedFirst = firstResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsedFirst.result?.content?.[0]?.text).toContain('First guess')
    expect(lastFrame()).toBeDefined()
  })

  it('unmount cleanup rejects pending question and closes server without hanging', async () => {
    const project = await initProject({
      name: 'Unmount Cleanup Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Unmount Task',
      status: 'refinement',
    }, tempProjectsDir)

    let callError: unknown

    const { lastFrame, stdin, unmount } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          try {
            await callAskQuestion(
              mcpServer.url,
              {
                confidence: 50,
                question: 'Will this unmount?',
                guess: 'Yes',
              },
              sessionId,
            )
          }
          catch (err) {
            callError = err
          }
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Will this unmount?')
    })
    unmount()

    await vi.waitFor(() => {
      expect(callError).toBeDefined()
    })
  })

  it('transitions to done state and closes server when runSession completes after refinement confirmation', async () => {
    const project = await initProject({
      name: 'Complete Session Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Complete Refine Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          await callCompleteRefinement(
            mcpServer.url,
            {
              outcome: 'Successful outcome',
              user: 'End users',
              whyNow: 'Urgent',
              success: 'All tests green',
              constraint: 'No regressions',
              outOfScope: 'Out of scope items',
            },
            sessionId,
          )
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Refinement completed for task #1 (Complete Refine Task)')
      expect(process.exitCode).toBeUndefined()
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when runSession finishes without confirming refinement', async () => {
    const project = await initProject({
      name: 'Premature Exit Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Premature Exit Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async () => {
          // Exits without calling complete_refinement
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Refinement session ended before task refinement was completed')
      expect(process.exitCode).toBe(1)
    })
  })

  it('renders [ERROR], sets process.exitCode = 1, and closes server when runSession throws', async () => {
    const project = await initProject({
      name: 'Error Session Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Error Refine Task',
      status: 'refinement',
    }, tempProjectsDir)

    const { lastFrame } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async () => {
          throw new Error('LLM process connection lost')
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('LLM process connection lost')
      expect(process.exitCode).toBe(1)
    })
  })

  it('handles complete_refinement feedback loop and final confirmation with Enter, writing intent.md and setting task to todo', async () => {
    const project = await initProject({
      name: 'Feedback Loop Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Refine Feedback Task',
      status: 'refinement',
    }, tempProjectsDir)

    let firstResult: unknown
    let secondResult: unknown

    const initialIntent = {
      outcome: 'Initial outcome',
      user: 'Engineers',
      whyNow: 'Needed now',
      success: 'Fast builds',
      constraint: 'Strict types',
      outOfScope: 'Legacy support',
    }

    const updatedIntent = {
      outcome: 'Updated outcome',
      user: 'All users',
      whyNow: 'Better UX',
      success: 'Clean test run',
      constraint: 'Zero dependencies',
      outOfScope: 'Experimental APIs',
    }

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)

          firstResult = await callCompleteRefinement(
            mcpServer.url,
            initialIntent,
            sessionId,
          )

          secondResult = await callCompleteRefinement(
            mcpServer.url,
            updatedIntent,
            sessionId,
          )
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
      expect(frame).toContain('Outcome:')
      expect(frame).toContain('Initial outcome')
      expect(frame).toContain('Confirm intent? (Enter/y to confirm, or type refinement feedback):')
    })

    await pressKey(stdin, 'Please adjust the outcome')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Please adjust the outcome')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(firstResult).toBeDefined()
    })

    const parsedFirst = firstResult as { result?: { content?: Array<{ text: string }> } }
    const firstBody = JSON.parse(parsedFirst.result?.content?.[0]?.text ?? '{}')
    expect(firstBody.confirmed).toBe(false)
    expect(firstBody.feedback).toBe('Please adjust the outcome')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Updated outcome')
      expect(frame).toContain('All users')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(secondResult).toBeDefined()
    })

    const parsedSecond = secondResult as { result?: { content?: Array<{ text: string }> } }
    const secondBody = JSON.parse(parsedSecond.result?.content?.[0]?.text ?? '{}')
    expect(secondBody.confirmed).toBe(true)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Refinement completed for task #1 (Refine Feedback Task)')
    })

    const taskDir = path.join(tempProjectsDir, project.slug, 'tasks', '1')
    const intentMdContent = await readFile(path.join(taskDir, 'intent.md'), 'utf8')
    expect(intentMdContent).toContain('# Statement of Intent: Refine Feedback Task (#1)')
    expect(intentMdContent).toContain('- **Outcome:** Updated outcome')
    expect(intentMdContent).toContain('- **User:** All users')

    const updatedTask = await getTask(project.slug, 1, tempProjectsDir)
    expect(updatedTask.status).toBe('todo')
  })

  it('accepts "y" to confirm intent during complete_refinement', async () => {
    const project = await initProject({
      name: 'Confirm Y Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Y Task',
      status: 'refinement',
    }, tempProjectsDir)

    let confirmResult: unknown

    const intent = {
      outcome: 'Y outcome',
      user: 'Users',
      whyNow: 'Now',
      success: 'Pass',
      constraint: 'Strict',
      outOfScope: 'None',
    }

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    await pressKey(stdin, 'y')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('y')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(confirmResult).toBeDefined()
    })

    const parsed = confirmResult as { result?: { content?: Array<{ text: string }> } }
    const body = JSON.parse(parsed.result?.content?.[0]?.text ?? '{}')
    expect(body.confirmed).toBe(true)
  })

  it('accepts literal "yes" (case-insensitive) to confirm intent during complete_refinement', async () => {
    const project = await initProject({
      name: 'Confirm Yes Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Yes Task',
      status: 'refinement',
    }, tempProjectsDir)

    let confirmResult: unknown

    const intent = {
      outcome: 'Yes outcome',
      user: 'Users',
      whyNow: 'Now',
      success: 'Pass',
      constraint: 'Strict',
      outOfScope: 'None',
    }

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    await pressKey(stdin, 'YES')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('YES')
    })

    await submitAndWait(stdin, '\r', () => {
      expect(confirmResult).toBeDefined()
    })

    const parsed = confirmResult as { result?: { content?: Array<{ text: string }> } }
    const body = JSON.parse(parsed.result?.content?.[0]?.text ?? '{}')
    expect(body.confirmed).toBe(true)
  })

  it('renders [ERROR], sets process.exitCode = 1, and rejects tool call when completeTaskRefinement fails during onConfirm', async () => {
    const project = await initProject({
      name: 'Fail Confirm Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
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
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          confirmResult = await callCompleteRefinement(
            mcpServer.url,
            intent,
            sessionId,
          )
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    // Corrupt task.json while awaiting user confirmation
    const taskJsonPath = path.join(tempProjectsDir, project.slug, 'tasks', '1', 'task.json')
    await rm(taskJsonPath, { force: true })

    await submitAndWait(stdin, '\r', () => {
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

  it('opens immediately to initial info prompt while runner starts in background, and resolves get_initial_context when submitted after agent calls it', async () => {
    const project = await initProject({
      name: 'Initial Context Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Initial Context Task',
      status: 'refinement',
    }, tempProjectsDir)

    let initialContextResult: unknown
    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-2.5-pro"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer, onStageChange }) => {
          onStageChange?.('spawning-agent')
          const sessionId = await initMcpSession(mcpServer.url)
          initialContextResult = await callGetInitialContext(mcpServer.url, {}, sessionId)
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('Refining Task #1: Initial Context Task')
      expect(frame).toContain('Describe what you want to build or refine:')
      expect(frame).toContain('Agent: Running')
      expect(frame).toContain('MCP: Connected')
    })

    await pressKey(stdin, 'Build an automated CLI onboarding wizard')
    await submitAndWait(stdin, '\r', () => {
      expect(initialContextResult).toBeDefined()
    })

    const parsed = initialContextResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsed.result?.content?.[0]?.text).toContain('Build an automated CLI onboarding wizard')

    finishSession!()
  })

  it('resolves get_initial_context when user submits initial info before agent calls get_initial_context', async () => {
    const project = await initProject({
      name: 'Early Submit Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Early Submit Task',
      status: 'refinement',
    }, tempProjectsDir)

    let initialContextResult: unknown
    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    let triggerAgentCall!: () => void
    const waitForUserInput = new Promise<void>((resolve) => {
      triggerAgentCall = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-2.5-pro"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          await waitForUserInput
          const sessionId = await initMcpSession(mcpServer.url)
          initialContextResult = await callGetInitialContext(mcpServer.url, {}, sessionId)
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })

    await pressKey(stdin, 'User typed this before agent asked')
    await submitAndWait(stdin, '\r', () => {
      expect(lastFrame() ?? '').toContain('Waiting for agent to formulate the next question...')
    })

    triggerAgentCall()

    await vi.waitFor(() => {
      expect(initialContextResult).toBeDefined()
    })

    const parsed = initialContextResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsed.result?.content?.[0]?.text).toContain('User typed this before agent asked')

    finishSession!()
  })

  it('transitions to finishing state with spinner inside fullscreen upon intent confirmation until runner exits', async () => {
    const project = await initProject({
      name: 'Finishing State Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Finishing Task',
      status: 'refinement',
    }, tempProjectsDir)

    let finishRunner: () => void
    const holdRunner = new Promise<void>((resolve) => {
      finishRunner = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          await callCompleteRefinement(
            mcpServer.url,
            {
              outcome: 'Successful outcome',
              user: 'End users',
              whyNow: 'Urgent',
              success: 'All tests green',
              constraint: 'No regressions',
              outOfScope: 'Out of scope items',
            },
            sessionId,
          )
          await holdRunner
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    // Submit confirmation
    await pressKey(stdin, '\r')

    // While runner is still pending, fullscreen should display finishing spinner
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Saving refinement and closing agent session...')
      expect(frame).not.toContain('[OK]')
    })

    // Allow runner to complete
    finishRunner!()

    // Once runner resolves, fullscreen unmounts and [OK] summary renders
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('Refinement completed for task #1 (Finishing Task)')
    })
  })

  it('appends answered question to history, renders thinking indicator, and updates statusbar', async () => {
    const project = await initProject({
      name: 'History And Thinking Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'History And Thinking Task',
      status: 'refinement',
    }, tempProjectsDir)

    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)
          await callAskQuestion(
            mcpServer.url,
            {
              confidence: 65,
              question: 'First question?',
              guess: 'First guess',
            },
            sessionId,
          )
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      const frame = stripAnsi(lastFrame() ?? '')
      expect(frame).toContain('First question?')
      expect(frame).toContain('Confidence: 65%')
      expect(frame).toContain('MCP: Connected')
    })

    await pressKey(stdin, 'Custom User Answer')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Custom User Answer')
    })

    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Agent is analyzing your response and formulating the next question...')
      expect(frame).toContain('[History: 1 past turn(s) - press PageUp to view]')
      expect(frame).toContain('[PgUp/PgDn]')
      expect(frame).toContain('History (1)')
    })

    finishSession!()
  })

  it('rejects ask_question with an error if called before get_initial_context', async () => {
    const project = await initProject({
      name: 'Premature Ask Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Premature Ask Task',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    const { lastFrame } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              confidence: 70,
              question: 'Premature question?',
              guess: 'Premature guess',
            },
            sessionId,
          )
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
      expect(toolResult).toBeDefined()
    })

    const parsed = toolResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsed.result?.isError).toBe(true)
    expect(parsed.result?.content?.[0]?.text).toContain('Initial context has not been retrieved. You must call get_initial_context first')

    finishSession!()
  })

  it('rejects complete_refinement with an error if called before get_initial_context', async () => {
    const project = await initProject({
      name: 'Premature Complete Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Premature Complete Task',
      status: 'refinement',
    }, tempProjectsDir)

    let toolResult: unknown
    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    const { lastFrame } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          toolResult = await callCompleteRefinement(
            mcpServer.url,
            {
              outcome: 'Early outcome',
              user: 'Users',
              whyNow: 'Now',
              success: 'Pass',
              constraint: 'None',
              outOfScope: 'None',
            },
            sessionId,
          )
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
      expect(toolResult).toBeDefined()
    })

    const parsed = toolResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsed.result?.isError).toBe(true)
    expect(parsed.result?.content?.[0]?.text).toContain('Initial context has not been retrieved. You must call get_initial_context first')

    finishSession!()
  })

  it('rejects get_initial_context with an error if called while ask_question is waiting', async () => {
    const project = await initProject({
      name: 'Context While Question Pending Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Context While Question Task',
      status: 'refinement',
    }, tempProjectsDir)

    let questionResult: unknown
    let contextResult: unknown

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          await callGetInitialContext(mcpServer.url, {}, sessionId)

          const questionPromise = callAskQuestion(
            mcpServer.url,
            {
              confidence: 60,
              question: 'Awaiting answer?',
              guess: 'Guess',
            },
            sessionId,
          ).then((r) => {
            questionResult = r
          })

          await new Promise(r => setTimeout(r, 50))

          contextResult = await callGetInitialContext(mcpServer.url, {}, sessionId)

          await questionPromise
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })
    await provideInitialContext(stdin)

    await vi.waitFor(() => {
      expect(contextResult).toBeDefined()
    })

    const parsedContext = contextResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsedContext.result?.isError).toBe(true)
    expect(parsedContext.result?.content?.[0]?.text).toContain('Only one tool call may be awaiting user response at a time')

    await submitAndWait(stdin, '\r', () => {
      expect(questionResult).toBeDefined()
    })
  })

  it('returns an error on get_initial_context when unmounted while waiting for user input', async () => {
    const project = await initProject({
      name: 'Unmount Initial Context Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Unmount Initial Context Task',
      status: 'refinement',
    }, tempProjectsDir)

    let initialContextResult: unknown
    let callError: unknown
    let agentWaitingOnContext = false

    const { unmount } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          agentWaitingOnContext = true
          try {
            initialContextResult = await callGetInitialContext(mcpServer.url, {}, sessionId)
          }
          catch (err) {
            callError = err
          }
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(agentWaitingOnContext).toBe(true)
    })

    // Small delay to ensure the request reached the MCP server and deferred promise is pending
    await new Promise(r => setTimeout(r, 50))
    unmount()

    await vi.waitFor(() => {
      expect(initialContextResult !== undefined || callError !== undefined).toBe(true)
    })

    if (initialContextResult !== undefined) {
      const parsed = initialContextResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
      expect(parsed.result?.isError).toBe(true)
      expect(parsed.result?.content?.[0]?.text).toContain('Refinement session unmounted')
    }
  })

  it('ignores empty initial context submission and awaits non-empty input', async () => {
    const project = await initProject({
      name: 'Empty Input Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { task } = await createTask({
      projectSlug: project.slug,
      name: 'Empty Input Task',
      status: 'refinement',
    }, tempProjectsDir)

    let initialContextResult: unknown
    let finishSession: () => void
    const holdSession = new Promise<void>((resolve) => {
      finishSession = resolve
    })

    const { lastFrame, stdin } = render(
      <RefinementSession
        model="gemini-4-argon-medium"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          initialContextResult = await callGetInitialContext(mcpServer.url, {}, sessionId)
          await holdSession
        }}
        task={task}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')
    })

    // Press Enter on blank input
    await pressKey(stdin, '\r')

    // Press spaces then Enter
    await pressKey(stdin, '   ')
    await pressKey(stdin, '\r')

    // Verify it didn't resolve get_initial_context and remains on the input screen
    await new Promise(r => setTimeout(r, 60))
    expect(initialContextResult).toBeUndefined()
    expect(lastFrame() ?? '').toContain('Describe what you want to build or refine:')

    // Now submit non-empty text
    await provideInitialContext(stdin, 'Valid non-empty requirement')

    await vi.waitFor(() => {
      expect(initialContextResult).toBeDefined()
    })

    const parsed = initialContextResult as { result?: { content?: Array<{ text: string }> } }
    expect(parsed.result?.content?.[0]?.text).toContain('Valid non-empty requirement')

    finishSession!()
  })
})
