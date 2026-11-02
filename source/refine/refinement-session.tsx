import type { ProjectRecord } from '../store/project-store.js'
import type { RefineIntent, Task } from '../store/task-store.js'
import type { AskQuestionInput, RefineConfirmationResult, RefineMcpServerInstance } from './refine-mcp-server.js'
import process from 'node:process'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { completeTaskRefinement } from '../store/task-store.js'
import { startRefineMcpServer } from './refine-mcp-server.js'

export interface RefineSessionContext {
  task: Task
  project: ProjectRecord
  model: string
  effort: string
  mcpServer: RefineMcpServerInstance
}

export type RefineSessionRunner = (ctx: RefineSessionContext) => Promise<void>

export interface RefinementSessionProps {
  task: Task
  project: ProjectRecord
  model: string
  effort: string
  projectsDir?: string
  runSession?: RefineSessionRunner
}

export type SessionState
  = | { status: 'waiting' }
    | {
      status: 'askingQuestion'
      question: AskQuestionInput
      onAnswer: (answer: string) => void
    }
    | {
      status: 'confirmingIntent'
      intent: RefineIntent
      onConfirm: (val: string) => void | Promise<void>
    }
    | { status: 'done' }
    | { message: string, status: 'error' }

export function RefinementSession({
  task,
  project,
  model,
  effort,
  projectsDir,
  runSession,
}: RefinementSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'waiting' })
  const activePendingToolRejectRef = useRef<((reason: Error) => void) | undefined>(undefined)

  useEffect(() => {
    let isMounted = true
    let serverInstance: RefineMcpServerInstance | undefined

    async function start() {
      try {
        const server = await startRefineMcpServer({
          onAskQuestion: async (question) => {
            if (!isMounted) {
              throw new Error('Refinement session terminated; no user available to answer')
            }

            if (activePendingToolRejectRef.current !== undefined) {
              throw new Error('Only one question may be asked at a time. Please wait for the current question to be answered before asking another.')
            }

            return new Promise<string>((resolve, reject) => {
              activePendingToolRejectRef.current = reject

              setSessionState({
                status: 'askingQuestion',
                question,
                onAnswer: (answer) => {
                  activePendingToolRejectRef.current = undefined
                  if (isMounted) {
                    setSessionState({ status: 'waiting' })
                  }
                  resolve(answer)
                },
              })
            })
          },
          onCompleteRefinement: async (intent) => {
            if (!isMounted) {
              throw new Error('Refinement session terminated; no user available to confirm')
            }

            if (activePendingToolRejectRef.current !== undefined) {
              throw new Error('Only one tool call may be awaiting user response at a time')
            }

            return new Promise<RefineConfirmationResult>((resolve, reject) => {
              activePendingToolRejectRef.current = reject

              setSessionState({
                status: 'confirmingIntent',
                intent,
                onConfirm: async (val) => {
                  activePendingToolRejectRef.current = undefined
                  const trimmed = val.trim()
                  const isConfirmed = trimmed === '' || /^y(?:es)?$/i.test(trimmed)

                  if (isConfirmed) {
                    try {
                      await completeTaskRefinement({
                        projectSlug: project.slug,
                        taskId: task.id,
                        intent,
                      }, projectsDir)
                      if (isMounted) {
                        setSessionState({ status: 'done' })
                      }
                      resolve({ confirmed: true })
                    }
                    catch (err) {
                      if (isMounted) {
                        process.exitCode = 1
                        setSessionState({
                          status: 'error',
                          message: toMessage(err),
                        })
                      }
                      if (err instanceof Error) {
                        reject(err)
                      }
                      else {
                        reject(new Error(String(err)))
                      }
                    }
                  }
                  else {
                    if (isMounted) {
                      setSessionState({ status: 'waiting' })
                    }
                    resolve({
                      confirmed: false,
                      feedback: trimmed,
                    })
                  }
                },
              })
            })
          },
        })

        serverInstance = server
        if (!isMounted) {
          await server.close()
          return
        }

        if (runSession) {
          await runSession({
            task,
            project,
            model,
            effort,
            mcpServer: server,
          })
        }

        if (isMounted) {
          setSessionState({ status: 'done' })
        }
      }
      catch (err) {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setSessionState({
          status: 'error',
          message: toMessage(err),
        })
      }
      finally {
        if (activePendingToolRejectRef.current !== undefined) {
          activePendingToolRejectRef.current(new Error('Refinement session ended'))
          activePendingToolRejectRef.current = undefined
        }
        if (serverInstance !== undefined) {
          await serverInstance.close()
        }
      }
    }

    void start()

    return () => {
      isMounted = false
      if (activePendingToolRejectRef.current !== undefined) {
        activePendingToolRejectRef.current(new Error('Refinement session unmounted'))
        activePendingToolRejectRef.current = undefined
      }
      if (serverInstance !== undefined) {
        void serverInstance.close()
      }
    }
  }, [
    task,
    project,
    model,
    effort,
    projectsDir,
    runSession,
  ])

  if (sessionState.status === 'error') {
    return <ErrorLine message={sessionState.message} />
  }

  if (sessionState.status === 'done') {
    return (
      <Box>
        <Text>
          <Text color="green">[OK]</Text>
          {` Refinement completed for task #${task.id} (${task.name})`}
        </Text>
      </Box>
    )
  }

  if (sessionState.status === 'confirmingIntent') {
    const { intent, onConfirm } = sessionState
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">STATEMENT OF INTENT:</Text>
        <Text>
          <Text bold color="cyan">Outcome: </Text>
          {intent.outcome}
        </Text>
        <Text>
          <Text bold color="cyan">User: </Text>
          {intent.user}
        </Text>
        <Text>
          <Text bold color="cyan">Why now: </Text>
          {intent.whyNow}
        </Text>
        <Text>
          <Text bold color="cyan">Success: </Text>
          {intent.success}
        </Text>
        <Text>
          <Text bold color="cyan">Constraint: </Text>
          {intent.constraint}
        </Text>
        <Text>
          <Text bold color="cyan">Out of scope: </Text>
          {intent.outOfScope}
        </Text>
        <Box marginTop={1}>
          <Text>Confirm intent? (Enter/y to confirm, or type refinement feedback): </Text>
          <TextInput
            placeholder="y"
            onSubmit={(val) => {
              void onConfirm(val)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (sessionState.status === 'askingQuestion') {
    const { question, onAnswer } = sessionState
    const hasMissing = question.missing !== undefined && question.missing !== ''
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color="cyan">HYPOTHESIS: </Text>
          {question.hypothesis}
        </Text>
        <Text>
          <Text bold color="cyan">CONFIDENCE: </Text>
          {`${question.confidence}%`}
        </Text>
        {hasMissing
          ? (
              <Text>
                <Text bold color="cyan">MISSING: </Text>
                {question.missing}
              </Text>
            )
          : null}
        <Text>
          <Text bold color="cyan">Q: </Text>
          {question.question}
        </Text>
        <Text>
          <Text bold color="cyan">GUESS: </Text>
          {question.guess}
        </Text>
        <Box marginTop={1}>
          <Text>Answer (press Enter to accept guess): </Text>
          <TextInput
            placeholder={question.guess}
            onSubmit={(val) => {
              const trimmed = val.trim()
              const answer = trimmed === ''
                ? question.guess
                : trimmed
              onAnswer(answer)
            }}
          />
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      <Text>
        <Text color="yellow">[RUNNING]</Text>
        {` Refining task #${task.id} (${task.name}) with ${model} (effort: ${effort})...`}
      </Text>
    </Box>
  )
}
