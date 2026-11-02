import type { AskQuestionInput, RefineMcpServerInstance } from '../refine/refine-mcp-server.js'
import type { ConfigSchema, RefineEffort } from '../store/config-store.js'
import type { Store } from '../store/create-store.js'
import type { Project } from '../store/project-store.js'
import type { Task } from '../store/task-store.js'
import path from 'node:path'
import process from 'node:process'
import { Select, TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { argument } from 'pastel'
import { useEffect, useMemo, useState } from 'react'
import zod from 'zod'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { startRefineMcpServer } from '../refine/refine-mcp-server.js'
import { configStore as defaultStore, RefineEffortSchema } from '../store/config-store.js'
import { findProjectByPath, getDefaultProjectsDir } from '../store/project-store.js'
import { getTask, listTasks } from '../store/task-store.js'

export const args = zod.tuple([
  zod.string().optional().describe(
    argument({
      name: 'id',
      description: 'Task ID to refine (e.g. 1 or #1; prompts if omitted)',
    }),
  ),
])

export const options = zod.object({
  model: zod.string().trim().min(1).optional().describe('Override refine.model for this session'),
  effort: RefineEffortSchema.optional().describe(`Override refine.effort for this session (${RefineEffortSchema.options.join('|')})`),
})

export interface RefineSessionContext {
  task: Task
  project: Project
  model: string
  effort: RefineEffort
  mcpServer: RefineMcpServerInstance
}

export type RefineSessionRunner = (ctx: RefineSessionContext) => Promise<void>

interface Props {
  args?: zod.infer<typeof args>
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
  configStore?: Store<typeof ConfigSchema>
  runSession?: RefineSessionRunner
}

type State
  = | { status: 'checking' }
    | { status: 'empty' }
    | { effort: RefineEffort, model: string, project: Project, status: 'selectTask', tasks: Task[] }
    | { effort: RefineEffort, model: string, project: Project, status: 'running', task: Task }
    | { message: string, status: 'error' }

type SessionState
  = | { status: 'waiting' }
    | {
      status: 'askingQuestion'
      question: AskQuestionInput
      onAnswer: (answer: string) => void
    }
    | { message: string, status: 'error' }

interface RefinementSessionProps {
  task: Task
  project: Project
  model: string
  effort: RefineEffort
  runSession?: RefineSessionRunner
}

function RefinementSession({
  task,
  project,
  model,
  effort,
  runSession,
}: RefinementSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'waiting' })

  useEffect(() => {
    let isMounted = true
    let serverInstance: RefineMcpServerInstance | undefined

    async function start() {
      try {
        const server = await startRefineMcpServer({
          onAskQuestion: async (question) => {
            return new Promise<string>((resolve) => {
              if (!isMounted) {
                resolve(question.guess)
                return
              }
              setSessionState({
                status: 'askingQuestion',
                question,
                onAnswer: (answer) => {
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
    }

    void start()

    return () => {
      isMounted = false
      if (serverInstance) {
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

export default function TaskRefine({
  args: cmdArgs,
  options: cmdOptions,
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
  configStore = defaultStore,
  runSession,
}: Props) {
  const [state, setState] = useState<State>({ status: 'checking' })
  const resolvedCwd = path.resolve(cwd)

  const parsedArgs = useMemo(() => args.parse(cmdArgs ?? [undefined]), [cmdArgs])
  const parsedOptions = useMemo(() => options.parse(cmdOptions ?? {}), [cmdOptions])
  const firstArg = parsedArgs[0]?.trim()
  const rawId = firstArg !== undefined && firstArg !== ''
    ? firstArg
    : undefined
  const { model: optModel, effort: optEffort } = parsedOptions

  useEffect(() => {
    let isMounted = true

    async function init() {
      try {
        const project = await findProjectByPath(resolvedCwd, projectsDir)
        if (!isMounted) {
          return
        }

        if (!project) {
          process.exitCode = 1
          setState({
            status: 'error',
            message: `Current directory "${resolvedCwd}" is not initialized as a project`,
          })
          return
        }

        const config = await configStore.read()
        if (!isMounted) {
          return
        }

        const resolvedModel = optModel ?? config.refine.model
        const resolvedEffort = optEffort ?? config.refine.effort

        if (rawId !== undefined) {
          const task = await getTask(project.slug, rawId, projectsDir)
          if (!isMounted) {
            return
          }

          if (task.status !== 'refinement') {
            process.exitCode = 1
            setState({
              status: 'error',
              message: `Task #${task.id} has status "${task.status}" (expected "refinement")`,
            })
            return
          }

          setState({
            status: 'running',
            task,
            project,
            model: resolvedModel,
            effort: resolvedEffort,
          })
        }
        else {
          const allTasks = await listTasks(project.slug, projectsDir)
          if (!isMounted) {
            return
          }

          const refinementTasks = allTasks.filter(t => t.status === 'refinement')
          if (refinementTasks.length === 0) {
            setState({ status: 'empty' })
            return
          }

          setState({
            status: 'selectTask',
            tasks: refinementTasks,
            project,
            model: resolvedModel,
            effort: resolvedEffort,
          })
        }
      }
      catch (err) {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setState({
          status: 'error',
          message: toMessage(err),
        })
      }
    }

    void init()

    return () => {
      isMounted = false
    }
  }, [
    resolvedCwd,
    projectsDir,
    configStore,
    rawId,
    optModel,
    optEffort,
  ])

  if (state.status === 'checking') {
    return null
  }

  if (state.status === 'error') {
    return <ErrorLine message={state.message} />
  }

  if (state.status === 'empty') {
    return <Text>No tasks in refinement status.</Text>
  }

  if (state.status === 'selectTask') {
    const selectOptions = state.tasks.map(task => ({
      label: `#${task.id} ${task.name} (${task.branch})`,
      value: String(task.id),
    }))

    return (
      <Box flexDirection="column">
        <Text>Select task to refine:</Text>
        <Select
          options={selectOptions}
          onChange={(val) => {
            const selected = state.tasks.find(t => String(t.id) === val)
            if (selected) {
              setState({
                status: 'running',
                task: selected,
                project: state.project,
                model: state.model,
                effort: state.effort,
              })
            }
          }}
        />
      </Box>
    )
  }

  if (state.status === 'running') {
    return (
      <RefinementSession
        effort={state.effort}
        model={state.model}
        project={state.project}
        runSession={runSession}
        task={state.task}
      />
    )
  }

  return null
}
