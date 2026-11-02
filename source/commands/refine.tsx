import type { RefineSessionRunner } from '../refine/refinement-session.js'
import type { ConfigSchema, RefineEffort } from '../store/config-store.js'
import type { Store } from '../store/create-store.js'
import type { ProjectRecord } from '../store/project-store.js'
import type { Task } from '../store/task-store.js'
import path from 'node:path'
import process from 'node:process'
import { Select } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { argument } from 'pastel'
import { useEffect, useMemo, useState } from 'react'
import zod from 'zod'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { RefinementSession } from '../refine/refinement-session.js'
import { configStore as defaultStore, RefineEffortSchema } from '../store/config-store.js'
import { findProjectByPath, getDefaultProjectsDir } from '../store/project-store.js'
import { getTask, listTasks } from '../store/task-store.js'

export type { RefineSessionContext, RefineSessionRunner } from '../refine/refinement-session.js'
export { defaultRefineSessionRunner } from '../refine/refinement-session.js'

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

interface Props {
  args?: zod.infer<typeof args>
  options?: zod.infer<typeof options>
  projectsDir?: string
  luddHomeDir?: string
  cwd?: string
  configStore?: Store<typeof ConfigSchema>
  runSession?: RefineSessionRunner
}

type State
  = | { status: 'checking' }
    | { status: 'empty' }
    | { effort: RefineEffort, model: string, project: ProjectRecord, status: 'selectTask', tasks: Task[] }
    | { effort: RefineEffort, model: string, project: ProjectRecord, status: 'running', task: Task }
    | { message: string, status: 'error' }

export default function TaskRefine({
  args: cmdArgs,
  options: cmdOptions,
  projectsDir = getDefaultProjectsDir(),
  luddHomeDir,
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
        luddHomeDir={luddHomeDir}
        model={state.model}
        project={state.project}
        projectsDir={projectsDir}
        runSession={runSession}
        task={state.task}
      />
    )
  }

  return null
}
