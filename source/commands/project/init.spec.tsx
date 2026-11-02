import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject, slugifyProjectName } from '../../store/project-store.js'
import { pressKey, submitAndWait } from '../../test-helpers.js'
import ProjectInit from './init.js'

describe('project init command', () => {
  let tempProjectsDir: string
  let tempWorkDir: string

  beforeEach(async () => {
    process.exitCode = 0
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-init-cmd-projects-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-init-cmd-workdir-'))
  })

  afterEach(async () => {
    process.exitCode = 0
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  it('initializes non-interactively when name and description are provided and renders [OK]', async () => {
    const { lastFrame } = render(
      <ProjectInit
        cwd={tempWorkDir}
        options={{
          name: 'My Service',
          description: 'Core microservice',
        }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('my-service')
      expect(frame.replace(/\n\s*/g, '')).toContain(path.join(tempProjectsDir, 'my-service', 'project.json'))
    })

    const projectFile = path.join(tempProjectsDir, 'my-service', 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content).toEqual({
      name: 'My Service',
      description: 'Core microservice',
      path: path.resolve(tempWorkDir),
      taskCounter: 0,
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when directory is already initialized', async () => {
    await initProject({
      name: 'Existing Project',
      path: tempWorkDir,
    }, tempProjectsDir)

    const { lastFrame } = render(
      <ProjectInit
        cwd={tempWorkDir}
        options={{ name: 'New Project' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame.replace(/\s+/g, ' ')).toContain('already initialized as project "Existing Project"')
      expect(frame).not.toContain('Project name:')
      expect(process.exitCode).toBe(1)
    })
  })

  it('prompts for name and accepts placeholder default on Enter', async () => {
    const { lastFrame, stdin } = render(
      <ProjectInit
        cwd={tempWorkDir}
        options={{ description: 'Some description' }}
        projectsDir={tempProjectsDir}
      />,
    )

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Project name:')
    })

    const folderName = path.basename(path.resolve(tempWorkDir))
    const expectedSlug = slugifyProjectName(folderName)

    // Press Enter to accept placeholder (folderName)
    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
    })

    const projectFile = path.join(tempProjectsDir, expectedSlug, 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content.name).toBe(folderName)
    expect(content.description).toBe('Some description')
    expect(content.path).toBe(path.resolve(tempWorkDir))
  })

  it('prompts for name and description interactively when both omitted', async () => {
    const { lastFrame, stdin } = render(
      <ProjectInit
        cwd={tempWorkDir}
        options={{}}
        projectsDir={tempProjectsDir}
      />,
    )

    // Wait for name prompt
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Project name:')
    })

    // Type custom name and press Enter
    await pressKey(stdin, 'Custom Project')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Custom Project')
    })

    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Project description:')
    })

    // Press Enter to accept empty description
    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('custom-project')
    })

    const projectFile = path.join(tempProjectsDir, 'custom-project', 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content).toEqual({
      name: 'Custom Project',
      description: '',
      path: path.resolve(tempWorkDir),
      taskCounter: 0,
    })
  })

  it('prompts for name instead of hanging when name option is whitespace-only', async () => {
    const { lastFrame, stdin } = render(
      <ProjectInit
        cwd={tempWorkDir}
        options={{ name: '   ', description: 'desc' }}
        projectsDir={tempProjectsDir}
      />,
    )

    // Verify it transitions to promptName instead of hanging in [RUNNING]
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Project name:')
      expect(frame).not.toContain('[RUNNING]')
    })

    const folderName = path.basename(path.resolve(tempWorkDir))
    const expectedSlug = slugifyProjectName(folderName)

    await submitAndWait(stdin, '\r', () => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
    })

    const projectFile = path.join(tempProjectsDir, expectedSlug, 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content.name).toBe(folderName)
    expect(content.description).toBe('desc')
  })
})
