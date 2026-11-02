import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../store/project-store.js'
import { createTask, getTask } from '../store/task-store.js'
import { RefinementSession } from './refinement-session.js'
import { callAskQuestion, callCompleteRefinement, initMcpSession } from './test-helpers.js'

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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
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
          await new Promise(() => {})
        }}
        task={task}
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

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          toolResult = await callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'Default hypothesis',
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
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Which framework should be used?')
    })

    stdin.write('Vue 3 instead')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Vue 3 instead')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          const firstCallPromise = callAskQuestion(
            mcpServer.url,
            {
              hypothesis: 'First hypothesis',
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
              hypothesis: 'Second hypothesis',
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
      expect(secondResult).toBeDefined()
    })

    const parsedSecond = secondResult as { result?: { isError?: boolean, content?: Array<{ text: string }> } }
    expect(parsedSecond.result?.isError).toBe(true)
    expect(parsedSecond.result?.content?.[0]?.text).toContain('Only one question may be asked at a time')

    stdin.write('\r')

    await vi.waitFor(() => {
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

    const { unmount } = render(
      <RefinementSession
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
          try {
            await callAskQuestion(
              mcpServer.url,
              {
                hypothesis: 'Unmount hypothesis',
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

    await new Promise(r => setTimeout(r, 80))
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
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
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    stdin.write('\r')

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
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
        effort="medium"
        model="Gemini 4 Argon"
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)

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
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
      expect(frame).toContain('Outcome:')
      expect(frame).toContain('Initial outcome')
      expect(frame).toContain('Confirm intent? (Enter/y to confirm, or type refinement feedback):')
    })

    stdin.write('Please adjust the outcome')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Please adjust the outcome')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
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

    stdin.write('\r')

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
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
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    stdin.write('y')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('y')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
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
      expect(lastFrame() ?? '').toContain('STATEMENT OF INTENT:')
    })

    stdin.write('YES')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('YES')
    })
    stdin.write('\r')

    await vi.waitFor(() => {
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
        effort="medium"
        model="Gemini 4 Argon"
        project={project}
        projectsDir={tempProjectsDir}
        runSession={async ({ mcpServer }) => {
          const sessionId = await initMcpSession(mcpServer.url)
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
      const frame = lastFrame() ?? ''
      expect(frame).toContain('STATEMENT OF INTENT:')
    })

    // Corrupt task.json while awaiting user confirmation
    const taskJsonPath = path.join(tempProjectsDir, project.slug, 'tasks', '1', 'task.json')
    await rm(taskJsonPath, { force: true })

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
