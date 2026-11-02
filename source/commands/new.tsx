import type { CreateTaskResult } from '../store/task-store.js'
import path from 'node:path'
import process from 'node:process'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import zod from 'zod'
import { ErrorLine, toMessage } from '../components/error-line.js'
import { findProjectByPath, getDefaultProjectsDir } from '../store/project-store.js'
import { createTask, slugifyBranchName } from '../store/task-store.js'

export const options = zod.object({
  name: zod.string().trim().min(1).optional().describe('Task name (prompts interactively if omitted)'),
  branch: zod.string().trim().min(1).optional().describe('Branch name (prompts with slugified task name if omitted)'),
})

type State
  = | { status: 'checking' }
    | { projectSlug: string, status: 'promptName' }
    | { defaultBranch: string, name: string, projectSlug: string, status: 'promptBranch' }
    | { branch: string, name: string, projectSlug: string, status: 'saving' }
    | { result: CreateTaskResult, status: 'done' }
    | { message: string, status: 'error' }

interface Props {
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
}

export default function TaskNew({
  options: cmdOptions = {},
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const resolvedCwd = path.resolve(cwd)
  const normalizedName = cmdOptions.name?.trim()

  const [state, setState] = useState<State>({ status: 'checking' })

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

        const projectSlug = project.slug

        if (normalizedName !== undefined && normalizedName !== '') {
          const defaultBranch = slugifyBranchName(normalizedName)
          if (cmdOptions.branch !== undefined) {
            const customBranch = cmdOptions.branch.trim()
            const branch = customBranch !== ''
              ? customBranch
              : defaultBranch
            setState({
              status: 'saving',
              projectSlug,
              name: normalizedName,
              branch,
            })
          }
          else {
            setState({
              status: 'promptBranch',
              projectSlug,
              name: normalizedName,
              defaultBranch,
            })
          }
        }
        else {
          setState({
            status: 'promptName',
            projectSlug,
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
    resolvedCwd,
    projectsDir,
    normalizedName,
    cmdOptions.branch,
  ])

  useEffect(() => {
    if (state.status !== 'saving') {
      return
    }

    let isMounted = true
    const { projectSlug, name, branch } = state

    createTask({
      projectSlug,
      name,
      branch,
    }, projectsDir)
      .then((res) => {
        if (!isMounted) {
          return
        }
        setState({ status: 'done', result: res })
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

  const handleNameSubmit = (value: string) => {
    if (state.status !== 'promptName') {
      return
    }
    const trimmed = value.trim()
    if (!trimmed) {
      process.exitCode = 1
      setState({
        status: 'error',
        message: 'Task name cannot be empty',
      })
      return
    }

    const defaultBranch = slugifyBranchName(trimmed)
    if (cmdOptions.branch !== undefined) {
      const customBranch = cmdOptions.branch.trim()
      const branch = customBranch !== ''
        ? customBranch
        : defaultBranch
      setState({
        status: 'saving',
        projectSlug: state.projectSlug,
        name: trimmed,
        branch,
      })
    }
    else {
      setState({
        status: 'promptBranch',
        projectSlug: state.projectSlug,
        name: trimmed,
        defaultBranch,
      })
    }
  }

  const handleBranchSubmit = (value: string) => {
    if (state.status !== 'promptBranch') {
      return
    }
    const chosenBranch = value.trim() || state.defaultBranch
    setState({
      status: 'saving',
      projectSlug: state.projectSlug,
      name: state.name,
      branch: chosenBranch,
    })
  }

  if (state.status === 'checking' || state.status === 'saving') {
    return (
      <Box>
        <Text>
          <Text color="yellow">[RUNNING]</Text>
          {' '}
          {state.status === 'checking'
            ? 'Checking project status...'
            : 'Creating task...'}
        </Text>
      </Box>
    )
  }

  if (state.status === 'error') {
    return <ErrorLine message={state.message} />
  }

  if (state.status === 'promptName') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>Task name: </Text>
          <TextInput
            placeholder="Implement feature X"
            onSubmit={handleNameSubmit}
          />
        </Box>
      </Box>
    )
  }

  if (state.status === 'promptBranch') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>Task name: </Text>
          <Text color="cyan">{state.name}</Text>
        </Box>
        <Box>
          <Text>Branch name: </Text>
          <TextInput
            placeholder={state.defaultBranch}
            onSubmit={handleBranchSubmit}
          />
        </Box>
      </Box>
    )
  }

  if (state.status === 'done') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>
            <Text color="green">[OK]</Text>
            {' '}
            Created task #
            {state.result.task.id}
            {' '}
            (
            {state.result.task.name}
            ) on branch
            {' '}
            {state.result.task.branch}
          </Text>
        </Box>
      </Box>
    )
  }

  return null
}
