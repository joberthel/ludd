import type { InitProjectResult } from '../../store/project-store.js'
import path from 'node:path'
import process from 'node:process'
import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import React, { useEffect, useState } from 'react'
import zod from 'zod'
import {
  findProjectByCwd,
  getDefaultProjectsDir,
  initProject,
} from '../../store/project-store.js'

export const options = zod.object({
  name: zod.string().trim().min(1).optional().describe('Project name (prompts interactively if omitted)'),
  description: zod.string().optional().describe('Project description (prompts interactively if omitted)'),
})

type Step
  = | 'checking'
    | 'promptName'
    | 'promptDescription'
    | 'saving'
    | 'done'
    | 'error'

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

  const [step, setStep] = useState<Step>('checking')
  const [name, setName] = useState<string>(normalizedName ?? '')
  const [description, setDescription] = useState<string>(cmdOptions.description ?? '')
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<InitProjectResult>()

  useEffect(() => {
    let isMounted = true

    findProjectByCwd(resolvedCwd, projectsDir)
      .then((existing) => {
        if (!isMounted) {
          return
        }

        if (existing) {
          process.exitCode = 1
          setError(`Directory "${resolvedCwd}" is already initialized as project "${existing.name}"`)
          setStep('error')
          return
        }

        if (normalizedName !== undefined && normalizedName !== '') {
          setName(normalizedName)
          if (cmdOptions.description !== undefined) {
            setDescription(cmdOptions.description)
            setStep('saving')
          }
          else {
            setStep('promptDescription')
          }
        }
        else {
          setStep('promptName')
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setError(err instanceof Error
          ? err.message
          : String(err))
        setStep('error')
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
    if (step !== 'saving') {
      return
    }

    let isMounted = true

    initProject({
      name,
      description,
      cwd: resolvedCwd,
    }, projectsDir)
      .then((res) => {
        if (!isMounted) {
          return
        }
        setResult(res)
        setStep('done')
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return
        }
        process.exitCode = 1
        setError(err instanceof Error
          ? err.message
          : String(err))
        setStep('error')
      })

    return () => {
      isMounted = false
    }
  }, [
    step,
    name,
    description,
    resolvedCwd,
    projectsDir,
  ])

  const handleNameSubmit = (value: string) => {
    const chosenName = value.trim() || folderName
    setName(chosenName)
    if (cmdOptions.description !== undefined) {
      setDescription(cmdOptions.description)
      setStep('saving')
    }
    else {
      setStep('promptDescription')
    }
  }

  const handleDescriptionSubmit = (value: string) => {
    setDescription(value.trim())
    setStep('saving')
  }

  if (step === 'checking' || step === 'saving') {
    return (
      <Box>
        <Text>
          <Text color="yellow">[RUNNING]</Text>
          {' '}
          {step === 'checking'
            ? 'Checking project status...'
            : 'Initializing project...'}
        </Text>
      </Box>
    )
  }

  if (step === 'error') {
    return (
      <Box>
        <Text>
          <Text color="red">[ERROR]</Text>
          {' '}
          {error}
        </Text>
      </Box>
    )
  }

  if (step === 'promptName') {
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

  if (step === 'promptDescription') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>Project name: </Text>
          <Text color="cyan">{name}</Text>
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

  if (!result) {
    return null
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          <Text color="green">[OK]</Text>
          {' '}
          Initialized project
          {' '}
          {result.slug}
          {' '}
          in
          {' '}
          {result.filePath}
        </Text>
      </Box>
    </Box>
  )
}
