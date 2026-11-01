import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProject } from '../../store/project-store.js'
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
      cwd: path.resolve(tempWorkDir),
    })
  })

  it('renders [ERROR] and sets process.exitCode = 1 when directory is already initialized', async () => {
    await initProject({
      name: 'Existing Project',
      cwd: tempWorkDir,
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
      expect(frame).toContain('already initialized as project "Existing Project"')
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

    // Press Enter to accept placeholder (folderName)
    stdin.write('\r')

    const folderName = path.basename(path.resolve(tempWorkDir))

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
    })

    const projectFile = path.join(tempProjectsDir, folderName, 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content.name).toBe(folderName)
    expect(content.description).toBe('Some description')
    expect(content.cwd).toBe(path.resolve(tempWorkDir))
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
    stdin.write('Custom Project')
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Custom Project')
    })
    stdin.write('\r')

    // Wait for description prompt
    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain('Project description:')
    })

    // Press Enter to accept empty description
    stdin.write('\r')

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('custom-project')
    })

    const projectFile = path.join(tempProjectsDir, 'custom-project', 'project.json')
    const content = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(content).toEqual({
      name: 'Custom Project',
      description: '',
      cwd: path.resolve(tempWorkDir),
    })
  })
})
