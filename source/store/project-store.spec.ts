import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  appendUniqueHash,
  findProjectByCwd,
  getDefaultProjectsDir,
  initProject,
  ProjectSchema,
  slugifyProjectName,
} from './project-store.js'

describe('projectStore', () => {
  let tempProjectsDir: string

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-projects-test-'))
  })

  afterEach(async () => {
    await rm(tempProjectsDir, { force: true, recursive: true })
  })

  describe('projectSchema', () => {
    it('validates a complete project object', () => {
      const valid = {
        name: 'My Service',
        description: 'A microservice for auth',
        cwd: '/Users/test/workspace/my-service',
      }
      expect(ProjectSchema.parse(valid)).toEqual(valid)
    })

    it('provides sensible defaults for missing fields', () => {
      const parsed = ProjectSchema.parse({})
      expect(parsed).toEqual({
        name: 'project',
        description: '',
        cwd: '/',
      })
    })

    it('rejects unknown keys due to strict()', () => {
      expect(() => ProjectSchema.parse({
        name: 'valid',
        cwd: '/valid',
        extraField: 'not allowed',
      })).toThrow(ZodError)
    })

    it('rejects empty or whitespace-only name', () => {
      expect(() => ProjectSchema.parse({ name: '', cwd: '/valid' })).toThrow(ZodError)
      expect(() => ProjectSchema.parse({ name: '   ', cwd: '/valid' })).toThrow(ZodError)
    })
  })

  describe('getDefaultProjectsDir', () => {
    it('returns path in ~/.ludd/projects', () => {
      expect(getDefaultProjectsDir()).toBe(path.join(os.homedir(), '.ludd', 'projects'))
    })
  })

  describe('slugifyProjectName', () => {
    it('normalizes spaces, uppercase characters, and punctuation', () => {
      expect(slugifyProjectName('My Awesome Project!')).toBe('my-awesome-project')
      expect(slugifyProjectName('  frontend-ui / dashboard  ')).toBe('frontend-ui-dashboard')
      expect(slugifyProjectName('API_v2.0_Client')).toBe('api-v2-0-client')
    })

    it('falls back to "project" when name contains only non-alphanumeric characters', () => {
      expect(slugifyProjectName('   ')).toBe('project')
      expect(slugifyProjectName('---')).toBe('project')
      expect(slugifyProjectName('!@#$%^&*()')).toBe('project')
    })
  })

  describe('appendUniqueHash', () => {
    it('appends 8-char hash suffix', () => {
      const result = appendUniqueHash('my-app', '12345678')
      expect(result).toBe('my-app-12345678')
    })

    it('uses a random 8-character hash when not supplied', () => {
      const result = appendUniqueHash('my-app')
      expect(result).toMatch(/^my-app-[a-f0-9]{8}$/)
    })
  })

  describe('findProjectByCwd', () => {
    it('returns undefined when projects directory is empty or does not exist', async () => {
      const nonExistent = path.join(tempProjectsDir, 'does-not-exist')
      expect(await findProjectByCwd('/some/path', nonExistent)).toBeUndefined()
      expect(await findProjectByCwd('/some/path', tempProjectsDir)).toBeUndefined()
    })

    it('returns project and slug when cwd matches', async () => {
      const cwd = path.join(tempProjectsDir, 'repo-a')
      await initProject({ name: 'Repo A', description: 'Description A', cwd }, tempProjectsDir)

      const found = await findProjectByCwd(cwd, tempProjectsDir)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Repo A')
      expect(found?.description).toBe('Description A')
      expect(found?.cwd).toBe(path.resolve(cwd))
      expect(found?.slug).toBe('repo-a')
    })

    it('matches paths regardless of trailing slashes or relative segments', async () => {
      const cwd = path.join(tempProjectsDir, 'repo-b')
      await initProject({ name: 'Repo B', cwd }, tempProjectsDir)

      const withTrailingSlash = `${cwd}/`
      const withRelative = path.join(tempProjectsDir, 'sub', '..', 'repo-b')

      expect(await findProjectByCwd(withTrailingSlash, tempProjectsDir)).toBeDefined()
      expect(await findProjectByCwd(withRelative, tempProjectsDir)).toBeDefined()
    })
  })

  describe('initProject', () => {
    it('creates project.json with correct metadata and returns slug and path', async () => {
      const cwd = path.join(tempProjectsDir, 'my-project')
      const result = await initProject({
        name: 'My Project',
        description: 'First project',
        cwd,
      }, tempProjectsDir)

      expect(result.slug).toBe('my-project')
      expect(result.project.name).toBe('My Project')
      expect(result.project.description).toBe('First project')
      expect(result.project.cwd).toBe(path.resolve(cwd))
      expect(result.filePath).toBe(path.join(tempProjectsDir, 'my-project', 'project.json'))

      const fileContent = JSON.parse(await readFile(result.filePath, 'utf8'))
      expect(fileContent).toEqual({
        name: 'My Project',
        description: 'First project',
        cwd: path.resolve(cwd),
      })
    })

    it('throws error when cwd is already initialized', async () => {
      const cwd = path.join(tempProjectsDir, 'existing-repo')
      await initProject({ name: 'Initial', cwd }, tempProjectsDir)

      await expect(initProject({ name: 'Duplicate', cwd }, tempProjectsDir)).rejects.toThrow(
        /already initialized/,
      )
    })

    it('resolves collision by appending 8-char hash when slug exists for a different cwd', async () => {
      const cwd1 = path.join(tempProjectsDir, 'folder1')
      const cwd2 = path.join(tempProjectsDir, 'folder2')

      const first = await initProject({ name: 'Common Name', cwd: cwd1 }, tempProjectsDir)
      expect(first.slug).toBe('common-name')

      const second = await initProject({ name: 'Common Name', cwd: cwd2 }, tempProjectsDir)
      expect(second.slug).toMatch(/^common-name-[a-f0-9]{8}$/)
      expect(second.slug).not.toBe(first.slug)

      // Verify original project on disk was NOT overwritten
      const firstContent = JSON.parse(await readFile(first.filePath, 'utf8'))
      expect(firstContent.cwd).toBe(path.resolve(cwd1))

      const secondContent = JSON.parse(await readFile(second.filePath, 'utf8'))
      expect(secondContent.cwd).toBe(path.resolve(cwd2))
    })
  })
})
