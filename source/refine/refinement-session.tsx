import type { ProjectRecord } from '../store/project-store.js'
import type { RefineIntent, Task } from '../store/task-store.js'
import type { InitStage } from './components/loading-screen.js'
import type { QnATurn } from './components/question-history.js'
import type { AskQuestionInput, RefineConfirmationResult, RefineMcpServerInstance } from './refine-mcp-server.js'
import process from 'node:process'
import { Spinner, TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { completeTaskRefinement } from '../store/task-store.js'
import { FullscreenContainer } from './components/fullscreen-container.js'
import { LoadingScreen } from './components/loading-screen.js'
import { QuestionDetails } from './components/question-details.js'
import { QuestionHistory } from './components/question-history.js'
import { Statusbar } from './components/statusbar.js'
import { TaskHeader } from './components/task-header.js'
import { ensureRefineSkill } from './ensure-refine-skill.js'
import { startRefineMcpServer } from './refine-mcp-server.js'
import { runAgyRefineSession } from './run-agy-session.js'

export type { InitStage } from './components/loading-screen.js'
export type { QnATurn } from './components/question-history.js'

export interface RefineSessionContext {
  task: Task
  project: ProjectRecord
  model: string
  mcpServer: RefineMcpServerInstance
  signal?: AbortSignal
  luddHomeDir?: string
  onStageChange?: (stage: InitStage, details?: { pid?: number }) => void
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
  projectsDir,
  luddHomeDir,
  runSession,
}: RefinementSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'waiting' })
  const [hasReceivedFirstToolCall, setHasReceivedFirstToolCall] = useState(false)
  const [initStage, setInitStage] = useState<InitStage>('starting-mcp')
  const [mcpPort, setMcpPort] = useState<number | undefined>(undefined)
  const [agentPid, setAgentPid] = useState<number | undefined>(undefined)
  const [mcpStatus, setMcpStatus] = useState<string>('Starting')
  const [history, setHistory] = useState<QnATurn[]>([])
  const [latestConfidence, setLatestConfidence] = useState<number | undefined>(undefined)

  const activePendingToolRejectRef = useRef<((reason: Error) => void) | undefined>(undefined)
  const isSubmittingRef = useRef(false)
  const confirmedRef = useRef(false)
  const sessionErrorOccurredRef = useRef(false)

  useEffect(() => {
    let isMounted = true
    let serverInstance: RefineMcpServerInstance | undefined
    const abortController = new AbortController()

    async function start() {
      try {
        setInitStage('starting-mcp')
        setMcpStatus('Starting')

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
              setHasReceivedFirstToolCall(true)
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

                  if (isMounted) {
                    setSessionState({ status: 'waiting' })
                  }
                  resolve(answer)
                  isSubmittingRef.current = false
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
              setHasReceivedFirstToolCall(true)
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
                      if (isMounted) {
                        setSessionState({ status: 'done' })
                      }
                      resolve({ confirmed: true })
                    }
                    catch (err) {
                      sessionErrorOccurredRef.current = true
                      activePendingToolRejectRef.current = undefined
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
                    finally {
                      isSubmittingRef.current = false
                    }
                  }
                  else {
                    try {
                      activePendingToolRejectRef.current = undefined
                      if (isMounted) {
                        setSessionState({ status: 'waiting' })
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

        try {
          const parsedUrl = new URL(server.url)
          if (parsedUrl.port) {
            setMcpPort(Number(parsedUrl.port))
          }
        }
        catch {}

        if (!isMounted) {
          await server.close()
          return
        }

        setInitStage('verifying-skill')
        const runner = runSession ?? defaultRefineSessionRunner
        await runner({
          task,
          project,
          model,
          mcpServer: server,
          signal: abortController.signal,
          luddHomeDir,
          onStageChange: (nextStage, details) => {
            if (isMounted) {
              setInitStage(nextStage)
              if (details?.pid !== undefined) {
                setAgentPid(details.pid)
              }
            }
          },
        })

        if (!isMounted) {
          return
        }

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
        setMcpStatus('Closed')
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
      abortController.abort()
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
      {!hasReceivedFirstToolCall
        ? (
            <LoadingScreen
              agentPid={agentPid}
              mcpPort={mcpPort}
              model={model}
              stage={initStage}
              taskId={task.id}
              taskName={task.name}
            />
          )
        : (
            <Box flexDirection="column" flexGrow={1} padding={1}>
              <TaskHeader taskId={task.id} taskName={task.name} />

              <QuestionHistory history={history} />

              {sessionState.status === 'waiting'
                ? (
                    <Box flexDirection="column" marginY={1}>
                      <Spinner label="Agent is analyzing your response and formulating the next question..." />
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
                      <Box marginTop={1}>
                        <Text>Answer (press Enter to accept guess): </Text>
                        <TextInput
                          placeholder={sessionState.question.guess}
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
            </Box>
          )}

      <Box width="100%">
        <Statusbar
          confidence={latestConfidence}
          historyCount={history.length}
          mcpStatus={mcpStatus}
          model={model}
        />
      </Box>
    </FullscreenContainer>
  )
}
