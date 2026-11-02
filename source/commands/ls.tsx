import type { Task } from '../store/task-store.js'
import path from 'node:path'
import process from 'node:process'
import { Box, Text, useStdout } from 'ink'
import { useEffect, useState } from 'react'
import stringWidth from 'string-width'
import zod from 'zod'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { findProjectByPath, getDefaultProjectsDir } from '../store/project-store.js'
import { listTasks } from '../store/task-store.js'

export const options = zod.object({
  format: zod.enum(['table', 'json']).default('table').describe('Output format (table or json)'),
})

interface Props {
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
}

type State
  = | { status: 'loading' }
    | { message: string, status: 'error' }
    | { status: 'done', tasks: Task[] }

export default function TaskLs({
  options: cmdOptions,
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const { format } = options.parse(cmdOptions ?? {})
  const { stdout } = useStdout()
  const resolvedCwd = path.resolve(cwd)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
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

        const tasks = await listTasks(project.slug, projectsDir)
        if (!isMounted) {
          return
        }

        setState({ status: 'done', tasks })
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
    resolvedCwd,
    projectsDir,
  ])

  useEffect(() => {
    if (state.status === 'done' && format === 'json') {
      stdout.write(`${JSON.stringify(state.tasks, null, 2)}\n`)
    }
  }, [
    state,
    format,
    stdout,
  ])

  if (state.status === 'loading') {
    return null
  }

  if (state.status === 'error') {
    return <ErrorLine message={state.message} />
  }

  if (format === 'json') {
    return null
  }

  const { tasks } = state

  if (tasks.length === 0) {
    return (
      <Box>
        <Text>No tasks found.</Text>
      </Box>
    )
  }

  const idWidth = Math.max('ID'.length, ...tasks.map(t => stringWidth(`#${t.id}`))) + 2
  const nameWidth = Math.max('NAME'.length, ...tasks.map(t => stringWidth(t.name))) + 2
  const branchWidth = Math.max('BRANCH'.length, ...tasks.map(t => stringWidth(t.branch))) + 2

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box width={idWidth}>
          <Text bold>ID</Text>
        </Box>
        <Box width={nameWidth}>
          <Text bold>NAME</Text>
        </Box>
        <Box width={branchWidth}>
          <Text bold>BRANCH</Text>
        </Box>
        <Box>
          <Text bold>STATUS</Text>
        </Box>
      </Box>
      {tasks.map(task => (
        <Box key={task.id} flexDirection="row">
          <Box width={idWidth}>
            <Text>
              #
              {task.id}
            </Text>
          </Box>
          <Box width={nameWidth}>
            <Text>{task.name}</Text>
          </Box>
          <Box width={branchWidth}>
            <Text>{task.branch}</Text>
          </Box>
          <Box>
            <Text>{task.status}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
