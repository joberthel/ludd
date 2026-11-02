import type { ProjectRecord } from '../../store/project-store.js'
import path from 'node:path'
import process from 'node:process'
import { ConfirmInput, MultiSelect } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import zod from 'zod'
import {
  findProjectByPath,
  getDefaultProjectsDir,
  listProjects,
  removeProjects,
} from '../../store/project-store.js'

export const options = zod.object({
  current: zod.boolean().default(false).describe('Remove the project for the current working directory'),
  force: zod.boolean().default(false).describe('Skip the y/n confirmation prompt'),
})

interface Props {
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
}

type State
  = | { status: 'checking' }
    | { status: 'empty' }
    | { projects: ProjectRecord[], status: 'selecting' }
    | { isCurrent: boolean, label?: string, slugs: string[], status: 'confirming' }
    | { isCurrent: boolean, slugs: string[], status: 'deleting' }
    | { message: string, status: 'done' }
    | { message: string, status: 'error' }

export default function ProjectRm({
  options: cmdOptions = { current: false, force: false },
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const resolvedCwd = path.resolve(cwd)
  const isCurrent = cmdOptions.current ?? false
  const isForce = cmdOptions.force ?? false

  const [state, setState] = useState<State>({ status: 'checking' })

  useEffect(() => {
    let isMounted = true

    if (isCurrent) {
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

          if (isForce) {
            setState({
              status: 'deleting',
              slugs: [project.slug],
              isCurrent: true,
            })
          }
          else {
            setState({
              status: 'confirming',
              slugs: [project.slug],
              label: project.name,
              isCurrent: true,
            })
          }
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
    }
    else {
      listProjects(projectsDir)
        .then((projects) => {
          if (!isMounted) {
            return
          }

          if (projects.length === 0) {
            setState({ status: 'empty' })
            return
          }

          setState({ status: 'selecting', projects })
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
    }

    return () => {
      isMounted = false
    }
  }, [
    resolvedCwd,
    projectsDir,
    isCurrent,
    isForce,
  ])

  useEffect(() => {
    if (state.status !== 'deleting') {
      return
    }

    let isMounted = true
    const { slugs, isCurrent: fromCurrent } = state

    removeProjects(slugs, projectsDir)
      .then(() => {
        if (!isMounted) {
          return
        }
        const message = fromCurrent
          ? `Removed project ${slugs[0]}`
          : `Removed ${slugs.length} project(s): ${slugs.join(', ')}`
        setState({ status: 'done', message })
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
  }, [state, projectsDir])

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
          Removing project(s)...
        </Text>
      </Box>
    )
  }

  if (state.status === 'empty') {
    return (
      <Box>
        <Text>No projects found.</Text>
      </Box>
    )
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
    const selectOptions = state.projects.map(p => ({
      label: `${p.name} (${p.slug})`,
      value: p.slug,
    }))

    const handleSelectSubmit = (selectedSlugs: string[]) => {
      if (selectedSlugs.length === 0) {
        setState({ status: 'done', message: 'No projects selected for removal.' })
        return
      }

      if (isForce) {
        setState({
          status: 'deleting',
          slugs: selectedSlugs,
          isCurrent: false,
        })
      }
      else {
        setState({
          status: 'confirming',
          slugs: selectedSlugs,
          isCurrent: false,
        })
      }
    }

    return (
      <Box flexDirection="column">
        <Text>Select project(s) to remove (Space to select, Enter to confirm):</Text>
        <MultiSelect
          options={selectOptions}
          onSubmit={handleSelectSubmit}
        />
      </Box>
    )
  }

  if (state.status === 'confirming') {
    const promptText = state.isCurrent
      ? `Remove project "${state.slugs[0]}"?`
      : `Remove ${state.slugs.length} project(s) (${state.slugs.join(', ')})?`

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
              slugs: state.slugs,
              isCurrent: state.isCurrent,
            })
          }}
        />
      </Box>
    )
  }

  return null
}
