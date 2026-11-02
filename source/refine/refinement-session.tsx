import type { Project } from '../store/project-store.js'
import type { Task } from '../store/task-store.js'
import type { AskQuestionInput, RefineMcpServerInstance } from './refine-mcp-server.js'
import process from 'node:process'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { startRefineMcpServer } from './refine-mcp-server.js'

export interface RefineSessionContext {
  task: Task
  project: Project
  model: string
  effort: string
  mcpServer: RefineMcpServerInstance
}

export type RefineSessionRunner = (ctx: RefineSessionContext) => Promise<void>

export interface RefinementSessionProps {
  task: Task
  project: Project
  model: string
  effort: string
  runSession?: RefineSessionRunner
}

export type SessionState
  = | { status: 'waiting' }
    | {
      status: 'askingQuestion'
      question: AskQuestionInput
      onAnswer: (answer: string) => void
    }
    | { status: 'done' }
    | { message: string, status: 'error' }

export function RefinementSession({
  task,
  project,
  model,
  effort,
  runSession,
}: RefinementSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'waiting' })
  const activeQuestionRejectRef = useRef<((reason: Error) => void) | undefined>(undefined)

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

            if (activeQuestionRejectRef.current !== undefined) {
              throw new Error('Only one question may be asked at a time. Please wait for the current question to be answered before asking another.')
            }

            return new Promise<string>((resolve, reject) => {
              activeQuestionRejectRef.current = reject

              setSessionState({
                status: 'askingQuestion',
                question,
                onAnswer: (answer) => {
                  activeQuestionRejectRef.current = undefined
                  if (isMounted) {
                    setSessionState({ status: 'waiting' })
                  }
                  resolve(answer)
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
        if (activeQuestionRejectRef.current !== undefined) {
          activeQuestionRejectRef.current(new Error('Refinement session ended'))
          activeQuestionRejectRef.current = undefined
        }
        if (serverInstance !== undefined) {
          await serverInstance.close()
        }
      }
    }

    void start()

    return () => {
      isMounted = false
      if (activeQuestionRejectRef.current !== undefined) {
        activeQuestionRejectRef.current(new Error('Refinement session unmounted'))
        activeQuestionRejectRef.current = undefined
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
    runSession,
  ])

  if (sessionState.status === 'error') {
    return <ErrorLine message={sessionState.message} />
  }

  if (sessionState.status === 'done') {
    return (
      <Box>
        <Text>
          <Text color="green">[DONE]</Text>
          {` Refinement completed for task #${task.id} (${task.name})`}
        </Text>
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
