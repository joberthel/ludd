import type { ProjectRecord } from '../../store/project-store.js'
import path from 'node:path'
import process from 'node:process'
import { Box, Text, useStdout } from 'ink'
import { useEffect, useState } from 'react'
import zod from 'zod'
import { ErrorLine, toMessage } from '../../components/error-line.js'
import { OptionalText } from '../../components/optional-text.js'
import { findProjectByPath, getDefaultProjectsDir } from '../../store/project-store.js'

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
    | { status: 'error', message: string }
    | { status: 'done', project: ProjectRecord }

export default function ProjectInfo({
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
      .then((project) => {
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

        setState({ status: 'done', project })
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
  }, [resolvedCwd, projectsDir])

  useEffect(() => {
    if (state.status === 'done' && format === 'json') {
      stdout.write(`${JSON.stringify(state.project, null, 2)}\n`)
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

  const { project } = state

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={14}>
          <Text bold>Name:</Text>
        </Box>
        <Text>{project.name}</Text>
      </Box>
      <Box>
        <Box width={14}>
          <Text bold>Slug:</Text>
        </Box>
        <Text>{project.slug}</Text>
      </Box>
      <Box>
        <Box width={14}>
          <Text bold>Description:</Text>
        </Box>
        <OptionalText value={project.description} />
      </Box>
      <Box>
        <Box width={14}>
          <Text bold>Path:</Text>
        </Box>
        <Text>{project.path}</Text>
      </Box>
    </Box>
  )
}
