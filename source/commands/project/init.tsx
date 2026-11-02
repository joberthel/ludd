import type { InitProjectResult } from '../../store/project-store.js'
import path from 'node:path'
import process from 'node:process'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import zod from 'zod'
import {
  findProjectByPath,
  getDefaultProjectsDir,
  initProject,
} from '../../store/project-store.js'

export const options = zod.object({
  name: zod.string().trim().min(1).optional().describe('Project name (prompts interactively if omitted)'),
  description: zod.string().optional().describe('Project description (prompts interactively if omitted)'),
})

type State
  = | { status: 'checking' }
    | { status: 'promptName' }
    | { name: string, status: 'promptDescription' }
    | { description: string, name: string, status: 'saving' }
    | { result: InitProjectResult, status: 'done' }
    | { message: string, status: 'error' }

interface Props {
  options?: zod.infer<typeof options>
  projectsDir?: string
  cwd?: string
}

export default function ProjectInit({
  options: cmdOptions = {},
  projectsDir = getDefaultProjectsDir(),
  cwd = process.cwd(),
}: Props) {
  const resolvedCwd = path.resolve(cwd)
  const folderName = path.basename(resolvedCwd)
  const normalizedName = cmdOptions.name?.trim()

  const [state, setState] = useState<State>({ status: 'checking' })

  useEffect(() => {
    let isMounted = true

    findProjectByPath(resolvedCwd, projectsDir)
      .then((existing) => {
        if (!isMounted) {
          return
        }

        if (existing) {
          process.exitCode = 1
          setState({
            status: 'error',
            message: `Directory "${resolvedCwd}" is already initialized as project "${existing.name}"`,
          })
          return
        }

        if (normalizedName !== undefined && normalizedName !== '') {
          if (cmdOptions.description !== undefined) {
            setState({
              status: 'saving',
              name: normalizedName,
              description: cmdOptions.description,
            })
          }
          else {
            setState({
              status: 'promptDescription',
              name: normalizedName,
            })
          }
        }
        else {
          setState({ status: 'promptName' })
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setState({
          status: 'error',
          message: err instanceof Error
            ? err.message
            : String(err),
        })
      })

    return () => {
      isMounted = false
    }
  }, [
    resolvedCwd,
    projectsDir,
    normalizedName,
    cmdOptions.description,
  ])

  useEffect(() => {
    if (state.status !== 'saving') {
      return
    }

    let isMounted = true
    const { name, description } = state

    initProject({
      name,
      description,
      path: resolvedCwd,
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
          message: err instanceof Error
            ? err.message
            : String(err),
        })
      })

    return () => {
      isMounted = false
    }
  }, [
    state,
    resolvedCwd,
    projectsDir,
  ])

  const handleNameSubmit = (value: string) => {
    const chosenName = value.trim() || folderName
    if (cmdOptions.description !== undefined) {
      setState({
        status: 'saving',
        name: chosenName,
        description: cmdOptions.description,
      })
    }
    else {
      setState({
        status: 'promptDescription',
        name: chosenName,
      })
    }
  }

  const handleDescriptionSubmit = (value: string) => {
    if (state.status !== 'promptDescription') {
      return
    }
    setState({
      status: 'saving',
      name: state.name,
      description: value.trim(),
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
            : 'Initializing project...'}
        </Text>
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

  if (state.status === 'promptName') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>Project name: </Text>
          <TextInput
            placeholder={folderName}
            onSubmit={handleNameSubmit}
          />
        </Box>
      </Box>
    )
  }

  if (state.status === 'promptDescription') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>Project name: </Text>
          <Text color="cyan">{state.name}</Text>
        </Box>
        <Box>
          <Text>Project description: </Text>
          <TextInput
            placeholder="Optional description..."
            onSubmit={handleDescriptionSubmit}
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
            Initialized project
            {' '}
            {state.result.slug}
            {' '}
            in
            {' '}
            {state.result.filePath}
          </Text>
        </Box>
      </Box>
    )
  }

  return null
}
