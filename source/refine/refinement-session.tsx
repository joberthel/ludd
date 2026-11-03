import type { ProjectRecord } from '../store/project-store.js'
import type { RefineIntent, Task } from '../store/task-store.js'
import type { QnATurn } from './components/question-history.js'
import type { AskQuestionInput, RefineConfirmationResult, RefineMcpServerInstance } from './refine-mcp-server.js'
import process from 'node:process'
import { Spinner, TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { completeTaskRefinement } from '../store/task-store.js'
import { FullscreenContainer } from './components/fullscreen-container.js'
import { QuestionDetails } from './components/question-details.js'
import { QuestionHistory } from './components/question-history.js'
import { Statusbar } from './components/statusbar.js'
import { TaskHeader } from './components/task-header.js'
import { ensureRefineSkill } from './ensure-refine-skill.js'
import { startRefineMcpServer } from './refine-mcp-server.js'
import { runAgyRefineSession } from './run-agy-session.js'

export type { QnATurn } from './components/question-history.js'

export interface RefineSessionContext {
  task: Task
  project: ProjectRecord
  model: string
  mcpServer: RefineMcpServerInstance
  signal?: AbortSignal
  luddHomeDir?: string
  onStageChange?: (stage: string, details?: { pid?: number }) => void
}

export type RefineSessionRunner = (ctx: RefineSessionContext) => Promise<void>

export const defaultRefineSessionRunner: RefineSessionRunner = async (ctx) => {
  ctx.onStageChange?.('verifying-skill')
  await ensureRefineSkill(ctx.luddHomeDir)
  ctx.onStageChange?.('spawning-agent')
  await runAgyRefineSession({
    task: ctx.task,
    project: ctx.project,
    model: ctx.model,
    mcpServer: ctx.mcpServer,
    luddHomeDir: ctx.luddHomeDir,
    signal: ctx.signal,
    onSpawn: (child) => {
      ctx.onStageChange?.('waiting-agent-first-question', { pid: child.pid })
    },
  })
}

export interface RefinementSessionProps {
  task: Task
  project: ProjectRecord
  model: string
  projectsDir?: string
  luddHomeDir?: string
  runSession?: RefineSessionRunner
}

export type SessionState
  = | { status: 'collectingInitialInput' }
    | { message?: string, status: 'waiting' }
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
    | { status: 'finishing' }
    | { status: 'done' }
    | { message: string, status: 'error' }

export function RefinementSession({
  task,
  project,
  model,
  projectsDir,
  luddHomeDir,
  runSession,
}: RefinementSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'collectingInitialInput' })
  const [mcpStatus, setMcpStatus] = useState<string>('Starting')
  const [agyStatus, setAgyStatus] = useState<string>('Starting')
  const [history, setHistory] = useState<QnATurn[]>([])
  const [latestConfidence, setLatestConfidence] = useState<number | undefined>(undefined)

  const isMountedRef = useRef(true)
  const activePendingToolRejectRef = useRef<((reason: Error) => void) | undefined>(undefined)
  const isSubmittingRef = useRef(false)
  const confirmedRef = useRef(false)
  const sessionErrorOccurredRef = useRef(false)

  const initialContextResolverRef = useRef<{
    promise: Promise<string>
    resolve: (val: string) => void
    reject: (err: Error) => void
  } | null>(null)

  if (initialContextResolverRef.current === null) {
    let resolve!: (val: string) => void
    let reject!: (err: Error) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    promise.catch(() => {})
    initialContextResolverRef.current = { promise, resolve, reject }
  }

  useEffect(() => {
    isMountedRef.current = true
    let serverInstance: RefineMcpServerInstance | undefined
    const abortController = new AbortController()

    async function start() {
      try {
        setMcpStatus('Starting')
        setAgyStatus('Starting')

        const server = await startRefineMcpServer({
          onGetInitialContext: async () => {
            if (!isMountedRef.current) {
              throw new Error('Refinement session terminated; no user available to provide context')
            }

            if (activePendingToolRejectRef.current !== undefined) {
              throw new Error('Only one tool call may be awaiting user response at a time')
            }

            return new Promise<string>((resolve, reject) => {
              activePendingToolRejectRef.current = reject
              initialContextResolverRef.current!.promise
                .then((context) => {
                  activePendingToolRejectRef.current = undefined
                  resolve(context)
                })
                .catch((err: Error) => {
                  activePendingToolRejectRef.current = undefined
                  reject(err)
                })
            })
          },
          onAskQuestion: async (question) => {
            if (!isMountedRef.current) {
              throw new Error('Refinement session terminated; no user available to answer')
            }

            if (activePendingToolRejectRef.current !== undefined) {
              throw new Error('Only one question may be asked at a time. Please wait for the current question to be answered before asking another.')
            }

            return new Promise<string>((resolve, reject) => {
              activePendingToolRejectRef.current = reject
              setLatestConfidence(question.confidence)

              setSessionState({
                status: 'askingQuestion',
                question,
                onAnswer: (answer) => {
                  if (isSubmittingRef.current) {
                    return
                  }
                  isSubmittingRef.current = true
                  activePendingToolRejectRef.current = undefined

                  const turn: QnATurn = {
                    confidence: question.confidence,
                    question: question.question,
                    guess: question.guess,
                    answer,
                  }
                  setHistory(prev => [...prev, turn])
                  setLatestConfidence(question.confidence)

                  if (isMountedRef.current) {
                    setSessionState({
                      status: 'waiting',
                      message: 'Agent is analyzing your response and formulating the next question...',
                    })
                  }
                  resolve(answer)
                  isSubmittingRef.current = false
                },
              })
            })
          },
          onCompleteRefinement: async (intent) => {
            if (!isMountedRef.current) {
              throw new Error('Refinement session terminated; no user available to confirm')
            }

            if (activePendingToolRejectRef.current !== undefined) {
              throw new Error('Only one tool call may be awaiting user response at a time')
            }

            return new Promise<RefineConfirmationResult>((resolve, reject) => {
              activePendingToolRejectRef.current = reject
              setLatestConfidence(95)

              setSessionState({
                status: 'confirmingIntent',
                intent,
                onConfirm: async (val) => {
                  if (isSubmittingRef.current) {
                    return
                  }
                  isSubmittingRef.current = true
                  const trimmed = val.trim()
                  const isConfirmed = trimmed === '' || /^y(?:es)?$/i.test(trimmed)

                  if (isConfirmed) {
                    try {
                      await completeTaskRefinement({
                        projectSlug: project.slug,
                        taskId: task.id,
                        intent,
                      }, projectsDir)
                      confirmedRef.current = true
                      activePendingToolRejectRef.current = undefined
                      if (isMountedRef.current) {
                        setSessionState({ status: 'finishing' })
                      }
                      resolve({ confirmed: true })
                    }
                    catch (err) {
                      sessionErrorOccurredRef.current = true
                      activePendingToolRejectRef.current = undefined
                      if (isMountedRef.current) {
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
                    finally {
                      isSubmittingRef.current = false
                    }
                  }
                  else {
                    try {
                      activePendingToolRejectRef.current = undefined
                      if (isMountedRef.current) {
                        setSessionState({
                          status: 'waiting',
                          message: 'Agent is analyzing your response and formulating the next question...',
                        })
                      }
                      resolve({
                        confirmed: false,
                        feedback: trimmed,
                      })
                    }
                    finally {
                      isSubmittingRef.current = false
                    }
                  }
                },
              })
            })
          },
        })

        serverInstance = server
        setMcpStatus('Connected')

        if (!isMountedRef.current) {
          await server.close()
          return
        }

        setAgyStatus('Starting')
        const runner = runSession ?? defaultRefineSessionRunner
        await runner({
          task,
          project,
          model,
          mcpServer: server,
          signal: abortController.signal,
          luddHomeDir,
          onStageChange: (nextStage, details) => {
            if (isMountedRef.current) {
              if (details?.pid !== undefined) {
                setAgyStatus('Running')
              }
              else if (nextStage === 'spawning-agent' || nextStage === 'waiting-agent-first-question') {
                setAgyStatus('Running')
              }
            }
          },
        })

        if (!isMountedRef.current) {
          return
        }

        setAgyStatus('Exited')

        if (confirmedRef.current) {
          setSessionState({ status: 'done' })
        }
        else if (!sessionErrorOccurredRef.current) {
          process.exitCode = 1
          setSessionState({
            status: 'error',
            message: 'Refinement session ended before task refinement was completed',
          })
        }
      }
      catch (err) {
        if (!isMountedRef.current) {
          return
        }
        process.exitCode = 1
        setSessionState({
          status: 'error',
          message: toMessage(err),
        })
      }
      finally {
        setMcpStatus('Closed')
        setAgyStatus('Exited')
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
      isMountedRef.current = false
      abortController.abort()
      initialContextResolverRef.current?.reject(new Error('Refinement session unmounted'))
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
    projectsDir,
    luddHomeDir,
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

  return (
    <FullscreenContainer>
      <Box flexDirection="column" flexGrow={1} padding={1}>
        <TaskHeader taskId={task.id} taskName={task.name} />

        <QuestionHistory history={history} />

        {sessionState.status === 'collectingInitialInput'
          ? (
              <Box flexDirection="column" marginTop={1}>
                <Text>Describe what you want to build or refine:</Text>
                <TextInput
                  onSubmit={(val) => {
                    const trimmed = val.trim()
                    initialContextResolverRef.current?.resolve(trimmed)
                    if (isMountedRef.current) {
                      setSessionState({
                        status: 'waiting',
                        message: 'Waiting for agent to formulate the next question...',
                      })
                    }
                  }}
                />
              </Box>
            )
          : null}

        {sessionState.status === 'waiting'
          ? (
              <Box flexDirection="column" marginY={1}>
                <Spinner label={sessionState.message ?? 'Waiting for agent to formulate the next question...'} />
              </Box>
            )
          : null}

        {sessionState.status === 'askingQuestion'
          ? (
              <Box flexDirection="column">
                <QuestionDetails
                  guess={sessionState.question.guess}
                  question={sessionState.question.question}
                />
                <Box flexDirection="column" marginTop={1}>
                  <Text>Answer (press Enter to accept guess):</Text>
                  <TextInput
                    onSubmit={(val) => {
                      const trimmed = val.trim()
                      const answer = trimmed === ''
                        ? sessionState.question.guess
                        : trimmed
                      sessionState.onAnswer(answer)
                    }}
                  />
                </Box>
              </Box>
            )
          : null}

        {sessionState.status === 'confirmingIntent'
          ? (
              <Box flexDirection="column">
                <Text bold color="cyan">STATEMENT OF INTENT:</Text>
                <Text>
                  <Text bold color="cyan">Outcome: </Text>
                  {sessionState.intent.outcome}
                </Text>
                <Text>
                  <Text bold color="cyan">User: </Text>
                  {sessionState.intent.user}
                </Text>
                <Text>
                  <Text bold color="cyan">Why now: </Text>
                  {sessionState.intent.whyNow}
                </Text>
                <Text>
                  <Text bold color="cyan">Success: </Text>
                  {sessionState.intent.success}
                </Text>
                <Text>
                  <Text bold color="cyan">Constraint: </Text>
                  {sessionState.intent.constraint}
                </Text>
                <Text>
                  <Text bold color="cyan">Out of scope: </Text>
                  {sessionState.intent.outOfScope}
                </Text>
                <Box marginTop={1}>
                  <Text>Confirm intent? (Enter/y to confirm, or type refinement feedback): </Text>
                  <TextInput
                    placeholder="y"
                    onSubmit={(val) => {
                      void sessionState.onConfirm(val)
                    }}
                  />
                </Box>
              </Box>
            )
          : null}

        {sessionState.status === 'finishing'
          ? (
              <Box flexDirection="column" marginY={1}>
                <Spinner label="Saving refinement and closing agent session..." />
              </Box>
            )
          : null}
      </Box>

      <Box width="100%">
        <Statusbar
          agyStatus={agyStatus}
          confidence={latestConfidence}
          historyCount={history.length}
          mcpStatus={mcpStatus}
          model={model}
        />
      </Box>
    </FullscreenContainer>
  )
}
