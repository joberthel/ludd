import type { ProjectRecord } from '../../store/project-store.js'
import path from 'node:path'
import process from 'node:process'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import zod from 'zod'
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
  options: cmdOptions = { format: 'table' },
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const resolvedCwd = path.resolve(cwd)
  const [state, setState] = useState<State>({ status: 'loading' })
  const format = cmdOptions.format ?? 'table'

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
        const message = err instanceof Error
          ? err.message
          : String(err)
        setState({
          status: 'error',
          message,
        })
      })

    return () => {
      isMounted = false
    }
  }, [resolvedCwd, projectsDir])

  if (state.status === 'loading') {
    return null
  }

  if (state.status === 'error') {
    return (
      <Box>
        <Text>
          <Text color="red">[ERROR]</Text>
          {' '}
          {state.message}
        </Text>
      </Box>
    )
  }

  const { project } = state

  if (format === 'json') {
    const formatted = {
      slug: project.slug,
      name: project.name,
      description: project.description,
      path: project.path,
    }
    return <Text>{JSON.stringify(formatted, null, 2)}</Text>
  }

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
        <Text>{project.description}</Text>
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
