import type { ProjectRecord } from '../store/project-store.js'
import type { RefineIntent, Task } from '../store/task-store.js'
import type { QnATurn } from './components/question-history.js'
import type {
  AskQuestionInput,
  RefineConfirmationResult,
  StartRefineMcpServerOptions,
} from './refine-mcp-server.js'
import type { SessionState } from './refinement-session.js'
import process from 'node:process'
import { useMemo, useRef } from 'react'
import { completeTaskRefinement } from '../store/task-store.js'

export interface UseRefineToolBridgeOptions {
  task: Task
  project: ProjectRecord
  projectsDir?: string
  isMountedRef: React.RefObject<boolean>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
  setLatestConfidence: (confidence: number) => void
  setHistory: React.Dispatch<React.SetStateAction<QnATurn[]>>
  confirmedRef: React.RefObject<boolean>
  sessionErrorOccurredRef: React.RefObject<boolean>
}

export interface RefineToolBridgeSession {
  mcpHandlers: StartRefineMcpServerOptions
  cleanup: () => void
}

export interface RefineToolBridge {
  submitInitialContext: (text: string) => boolean
  createSession: () => RefineToolBridgeSession
}

export function useRefineToolBridge(options: UseRefineToolBridgeOptions): RefineToolBridge {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const activePendingToolRejectRef = useRef<((reason: Error) => void) | undefined>(undefined)
  const initialContextResolverRef = useRef<((val: string) => void) | undefined>(undefined)

  return useMemo(() => {
    const submitInitialContext = (text: string): boolean => {
      const trimmed = text.trim()
      if (trimmed === '') {
        return false
      }
      initialContextResolverRef.current?.(trimmed)
      return true
    }

    const createSession = (): RefineToolBridgeSession => {
      let hasInitialContext = false
      let cachedInitialContext: string | undefined
      let initialContextResolved = false

      let resolveInitialContext: ((val: string) => void) | undefined
      let rejectInitialContext: ((err: Error) => void) | undefined

      const initialContextPromise = new Promise<string>((resolve, reject) => {
        resolveInitialContext = (val) => {
          initialContextResolved = true
          cachedInitialContext = val
          resolve(val)
        }
        rejectInitialContext = reject
      })
      initialContextPromise.catch(() => {}) // Prevent unhandled rejection if never awaited

      initialContextResolverRef.current = resolveInitialContext

      function checkActiveAndMounted(toolName: string): void {
        if (!optionsRef.current.isMountedRef.current) {
          throw new Error(`Refinement session terminated; cannot handle ${toolName}`)
        }
        if (activePendingToolRejectRef.current !== undefined) {
          throw new Error('Only one tool call may be awaiting user response at a time')
        }
      }

      function checkInitialContextRetrieved(toolName: string): void {
        if (!hasInitialContext) {
          throw new Error(`Initial context has not been retrieved. You must call get_initial_context first before ${toolName}.`)
        }
      }

      const mcpHandlers: StartRefineMcpServerOptions = {
        onGetInitialContext: async () => {
          checkActiveAndMounted('get_initial_context')

          if (cachedInitialContext !== undefined) {
            hasInitialContext = true
            return cachedInitialContext
          }

          return new Promise<string>((resolve, reject) => {
            activePendingToolRejectRef.current = reject
            initialContextPromise
              .then((context) => {
                activePendingToolRejectRef.current = undefined
                hasInitialContext = true
                resolve(context)
              })
              .catch((err: Error) => {
                activePendingToolRejectRef.current = undefined
                reject(err)
              })
          })
        },

        onAskQuestion: async (question: AskQuestionInput) => {
          checkActiveAndMounted('ask_question')
          checkInitialContextRetrieved('calling ask_question')

          optionsRef.current.setLatestConfidence(question.confidence)

          return new Promise<string>((resolve, reject) => {
            activePendingToolRejectRef.current = reject

            let answered = false

            optionsRef.current.setSessionState({
              status: 'askingQuestion',
              question,
              onAnswer: (answer) => {
                if (answered) {
                  return
                }
                answered = true
                activePendingToolRejectRef.current = undefined

                const turn: QnATurn = {
                  question: question.question,
                  guess: question.guess,
                  answer,
                }
                optionsRef.current.setHistory(prev => [...prev, turn])

                if (optionsRef.current.isMountedRef.current) {
                  optionsRef.current.setSessionState({
                    status: 'waiting',
                    message: 'Agent is analyzing your response and formulating the next question...',
                  })
                }
                resolve(answer)
              },
            })
          })
        },

        onCompleteRefinement: async (intent: RefineIntent) => {
          checkActiveAndMounted('complete_refinement')
          checkInitialContextRetrieved('calling complete_refinement')

          return new Promise<RefineConfirmationResult>((resolve, reject) => {
            activePendingToolRejectRef.current = reject

            let handled = false

            optionsRef.current.setSessionState({
              status: 'confirmingIntent',
              intent,
              onConfirm: async (val) => {
                if (handled) {
                  return
                }
                handled = true
                const trimmed = val.trim()
                const isConfirmed = trimmed === '' || /^y(?:es)?$/i.test(trimmed)

                if (isConfirmed) {
                  try {
                    await completeTaskRefinement({
                      projectSlug: optionsRef.current.project.slug,
                      taskId: optionsRef.current.task.id,
                      intent,
                    }, optionsRef.current.projectsDir)
                    optionsRef.current.confirmedRef.current = true
                    activePendingToolRejectRef.current = undefined
                    if (optionsRef.current.isMountedRef.current) {
                      optionsRef.current.setSessionState({ status: 'finishing' })
                    }
                    resolve({ confirmed: true })
                  }
                  catch (err) {
                    optionsRef.current.sessionErrorOccurredRef.current = true
                    activePendingToolRejectRef.current = undefined
                    if (optionsRef.current.isMountedRef.current) {
                      process.exitCode = 1
                      optionsRef.current.setSessionState({
                        status: 'error',
                        message: err instanceof Error
                          ? err.message
                          : String(err),
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
                  activePendingToolRejectRef.current = undefined
                  if (optionsRef.current.isMountedRef.current) {
                    optionsRef.current.setSessionState({
                      status: 'waiting',
                      message: 'Agent is analyzing your response and formulating the next question...',
                    })
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
      }

      const cleanup = () => {
        initialContextResolverRef.current = undefined
        if (!initialContextResolved) {
          rejectInitialContext?.(new Error('Refinement session unmounted'))
        }
        if (activePendingToolRejectRef.current !== undefined) {
          activePendingToolRejectRef.current(new Error('Refinement session unmounted'))
          activePendingToolRejectRef.current = undefined
        }
      }

      return {
        mcpHandlers,
        cleanup,
      }
    }

    return {
      submitInitialContext,
      createSession,
    }
  }, [])
}
