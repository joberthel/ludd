import type { ProjectRecord } from '../../store/project-store.js'
import process from 'node:process'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import stringWidth from 'string-width'
import zod from 'zod'
import { ErrorLine, toMessage } from '../../components/error-line.js'
import { getDefaultProjectsDir, listProjects } from '../../store/project-store.js'

export const options = zod.object({
  format: zod.enum(['table', 'json']).default('table').describe('Output format (table or json)'),
})

interface Props {
  options?: zod.infer<typeof options>
  projectsDir?: string
}

type State
  = | { status: 'loading' }
    | { status: 'error', message: string }
    | { status: 'done', projects: ProjectRecord[] }

export default function ProjectLs({
  options: cmdOptions,
  projectsDir = getDefaultProjectsDir(),
}: Props) {
  const { format } = options.parse(cmdOptions ?? {})
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    listProjects(projectsDir)
      .then((projects) => {
        if (!isMounted) {
          return
        }
        setState({ status: 'done', projects })
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
  }, [projectsDir])

  if (state.status === 'loading') {
    return null
  }

  if (state.status === 'error') {
    return <ErrorLine message={state.message} />
  }

  const { projects } = state

  if (format === 'json') {
    return <Text>{JSON.stringify(projects, null, 2)}</Text>
  }

  if (projects.length === 0) {
    return (
      <Box>
        <Text>No projects found.</Text>
      </Box>
    )
  }

  const nameWidth = Math.max('NAME'.length, ...projects.map(p => stringWidth(p.name))) + 2
  const slugWidth = Math.max('SLUG'.length, ...projects.map(p => stringWidth(p.slug))) + 2
  const descWidth = Math.max(
    'DESCRIPTION'.length,
    ...projects.map(p => stringWidth(p.description || '(none)')),
  ) + 2

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box width={nameWidth}>
          <Text bold>NAME</Text>
        </Box>
        <Box width={slugWidth}>
          <Text bold>SLUG</Text>
        </Box>
        <Box width={descWidth}>
          <Text bold>DESCRIPTION</Text>
        </Box>
        <Box>
          <Text bold>PATH</Text>
        </Box>
      </Box>
      {projects.map(project => (
        <Box key={project.slug} flexDirection="row">
          <Box width={nameWidth}>
            <Text>{project.name}</Text>
          </Box>
          <Box width={slugWidth}>
            <Text>{project.slug}</Text>
          </Box>
          <Box width={descWidth}>
            {project.description
              ? (
                  <Text>{project.description}</Text>
                )
              : (
                  <Text color="gray" dimColor>(none)</Text>
                )}
          </Box>
          <Box>
            <Text>{project.path}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
