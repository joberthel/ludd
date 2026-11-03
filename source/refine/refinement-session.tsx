import type { ProjectRecord } from '../store/project-store.js'
import type { RefineIntent, Task } from '../store/task-store.js'
import type { QnATurn } from './components/question-history.js'
import type { AskQuestionInput, RefineMcpServerInstance } from './refine-mcp-server.js'
import process from 'node:process'
import { Spinner, TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { FullscreenContainer } from './components/fullscreen-container.js'
import { IntentConfirmation } from './components/intent-confirmation.js'
import { QuestionDetails } from './components/question-details.js'
import { QuestionHistory } from './components/question-history.js'
import { Statusbar } from './components/statusbar.js'
import { TaskHeader } from './components/task-header.js'
import { ensureRefineSkill } from './ensure-refine-skill.js'
import { startRefineMcpServer } from './refine-mcp-server.js'
import { runAgyRefineSession } from './run-agy-session.js'
import { useRefineToolBridge } from './use-refine-tool-bridge.js'

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
  const confirmedRef = useRef(false)
  const sessionErrorOccurredRef = useRef(false)

  const bridge = useRefineToolBridge({
    task,
    project,
    projectsDir,
    isMountedRef,
    setSessionState,
    setLatestConfidence,
    setHistory,
    confirmedRef,
    sessionErrorOccurredRef,
  })

  useEffect(() => {
    isMountedRef.current = true
    let serverInstance: RefineMcpServerInstance | undefined
    const abortController = new AbortController()

    const session = bridge.createSession()

    async function start() {
      try {
        setMcpStatus('Starting')
        setAgyStatus('Starting')

        const server = await startRefineMcpServer(session.mcpHandlers)
        serverInstance = server
        setMcpStatus('Connected')

        if (!isMountedRef.current) {
          await server.close()
          return
        }

        const runner = runSession ?? defaultRefineSessionRunner
        await runner({
          task,
          project,
          model,
          mcpServer: server,
          signal: abortController.signal,
          luddHomeDir,
          onStageChange: (nextStage, details) => {
            if (isMountedRef.current && (details?.pid !== undefined || nextStage !== 'verifying-skill')) {
              setAgyStatus('Running')
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
        session.cleanup()
        if (serverInstance !== undefined) {
          await serverInstance.close()
        }
      }
    }

    void start()

    return () => {
      isMountedRef.current = false
      abortController.abort()
      session.cleanup()
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
    bridge,
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
                    const submitted = bridge.submitInitialContext(val)
                    if (submitted && isMountedRef.current) {
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
              <IntentConfirmation
                intent={sessionState.intent}
                onConfirm={sessionState.onConfirm}
              />
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
