import type { Task } from '../store/task-store.js'
import path from 'node:path'
import process from 'node:process'
import { ConfirmInput, MultiSelect } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { argument } from 'pastel'
import { useEffect, useMemo, useState } from 'react'
import zod from 'zod'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { findProjectByPath, getDefaultProjectsDir } from '../store/project-store.js'
import { listTasks, parseTaskId, removeTasks } from '../store/task-store.js'

export const args = zod.array(zod.string()).default([]).describe(
  argument({
    name: 'ids',
    description: 'Task ID(s) to remove (e.g. 1 #2)',
  }),
)

export const options = zod.object({
  all: zod.boolean().default(false).describe('Remove all tasks in the current project'),
  force: zod.boolean().default(false).describe('Skip the y/n confirmation prompt'),
})

interface Props {
  args?: string[]
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
}

type State
  = | { status: 'checking' }
    | { status: 'empty' }
    | { projectSlug: string, status: 'selecting', tasks: Task[] }
    | { ids: number[], projectSlug: string, status: 'confirming' }
    | { ids: number[], projectSlug: string, status: 'deleting' }
    | { message: string, status: 'done' }
    | { message: string, status: 'error' }

export default function TaskRm({
  args: cmdArgs = [],
  options: cmdOptions,
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const { all: isAll, force: isForce } = options.parse(cmdOptions ?? {})
  const rawIds = useMemo(() => args.parse(cmdArgs ?? []), [cmdArgs])
  const resolvedCwd = path.resolve(cwd)

  const hasConflict = rawIds.length > 0 && isAll

  const [state, setState] = useState<State>(() => {
    if (hasConflict) {
      process.exitCode = 1
      return {
        status: 'error',
        message: 'Cannot specify both task IDs and --all',
      }
    }
    return { status: 'checking' }
  })

  useEffect(() => {
    if (state.status !== 'checking') {
      return
    }

    let isMounted = true

    findProjectByPath(resolvedCwd, projectsDir)
      .then(async (project) => {
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

        const projectSlug = project.slug
        const tasks = await listTasks(projectSlug, projectsDir)
        if (!isMounted) {
          return
        }

        if (rawIds.length > 0) {
          let targetIds: number[]
          try {
            targetIds = [
              ...new Set(rawIds.map(id => parseTaskId(id))),
            ]
          }
          catch (err) {
            process.exitCode = 1
            setState({
              status: 'error',
              message: toMessage(err),
            })
            return
          }

          const existingIds = new Set(tasks.map(t => t.id))
          for (const id of targetIds) {
            if (!existingIds.has(id)) {
              process.exitCode = 1
              setState({
                status: 'error',
                message: `Task #${id} does not exist in project "${projectSlug}"`,
              })
              return
            }
          }

          if (isForce) {
            setState({
              status: 'deleting',
              projectSlug,
              ids: targetIds,
            })
          }
          else {
            setState({
              status: 'confirming',
              projectSlug,
              ids: targetIds,
            })
          }
        }
        else if (isAll) {
          if (tasks.length === 0) {
            setState({ status: 'empty' })
            return
          }

          const targetIds = tasks.map(t => t.id)
          if (isForce) {
            setState({
              status: 'deleting',
              projectSlug,
              ids: targetIds,
            })
          }
          else {
            setState({
              status: 'confirming',
              projectSlug,
              ids: targetIds,
            })
          }
        }
        else {
          if (tasks.length === 0) {
            setState({ status: 'empty' })
            return
          }

          setState({
            status: 'selecting',
            projectSlug,
            tasks,
          })
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setState({
          status: 'error',
          message: toMessage(err),
        })
      })

    return () => {
      isMounted = false
    }
  }, [
    state.status,
    resolvedCwd,
    projectsDir,
    rawIds,
    isAll,
    isForce,
  ])

  useEffect(() => {
    if (state.status !== 'deleting') {
      return
    }

    let isMounted = true
    const { projectSlug, ids } = state

    removeTasks(projectSlug, ids, projectsDir)
      .then(() => {
        if (!isMounted) {
          return
        }
        const message = ids.length === 1
          ? `Removed task #${ids[0]}`
          : `Removed ${ids.length} task(s): #${ids.join(', #')}`
        setState({ status: 'done', message })
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setState({
          status: 'error',
          message: toMessage(err),
        })
      })

    return () => {
      isMounted = false
    }
  }, [
    state,
    projectsDir,
  ])

  if (state.status === 'checking') {
    return (
      <Box>
        <Text>
          <Text color="yellow">[RUNNING]</Text>
          {' '}
          Checking project status...
        </Text>
      </Box>
    )
  }

  if (state.status === 'deleting') {
    return (
      <Box>
        <Text>
          <Text color="yellow">[RUNNING]</Text>
          {' '}
          Removing task(s)...
        </Text>
      </Box>
    )
  }

  if (state.status === 'empty') {
    return (
      <Box>
        <Text>No tasks found.</Text>
      </Box>
    )
  }

  if (state.status === 'error') {
    return <ErrorLine message={state.message} />
  }

  if (state.status === 'done') {
    return (
      <Box>
        <Text>
          <Text color="green">[OK]</Text>
          {' '}
          {state.message}
        </Text>
      </Box>
    )
  }

  if (state.status === 'selecting') {
    const selectOptions = state.tasks.map(t => ({
      label: `#${t.id} ${t.name} (${t.branch})`,
      value: String(t.id),
    }))

    const handleSelectSubmit = (selectedValues: string[]) => {
      if (selectedValues.length === 0) {
        setState({ status: 'done', message: 'No tasks selected for removal.' })
        return
      }

      const selectedIds = selectedValues.map(v => Number.parseInt(v, 10))

      if (isForce) {
        setState({
          status: 'deleting',
          projectSlug: state.projectSlug,
          ids: selectedIds,
        })
      }
      else {
        setState({
          status: 'confirming',
          projectSlug: state.projectSlug,
          ids: selectedIds,
        })
      }
    }

    return (
      <Box flexDirection="column">
        <Text>Select task(s) to remove (Space to select, Enter to confirm):</Text>
        <MultiSelect
          options={selectOptions}
          onSubmit={handleSelectSubmit}
        />
      </Box>
    )
  }

  if (state.status === 'confirming') {
    const promptText = state.ids.length === 1
      ? `Remove task #${state.ids[0]}?`
      : `Remove ${state.ids.length} task(s) (#${state.ids.join(', #')})?`

    return (
      <Box flexDirection="column">
        <Text>{promptText}</Text>
        <ConfirmInput
          onCancel={() => {
            setState({ status: 'done', message: 'Removal cancelled.' })
          }}
          onConfirm={() => {
            setState({
              status: 'deleting',
              projectSlug: state.projectSlug,
              ids: state.ids,
            })
          }}
        />
      </Box>
    )
  }

  return null
}
