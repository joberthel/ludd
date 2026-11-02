import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  appendUniqueHash,
  findProjectByPath,
  getDefaultProjectsDir,
  initProject,
  listProjects,
  ProjectSchema,
  removeProjects,
  RemoveProjectsError,
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
        path: '/Users/test/workspace/my-service',
      }
      expect(ProjectSchema.parse(valid)).toEqual(valid)
    })

    it('provides sensible defaults for missing fields', () => {
      const parsed = ProjectSchema.parse({})
      expect(parsed).toEqual({
        name: 'project',
        description: '',
        path: '/',
      })
    })

    it('rejects unknown keys due to strict()', () => {
      expect(() => ProjectSchema.parse({
        name: 'valid',
        path: '/valid',
        extraField: 'not allowed',
      })).toThrow(ZodError)
    })

    it('rejects empty or whitespace-only name', () => {
      expect(() => ProjectSchema.parse({ name: '', path: '/valid' })).toThrow(ZodError)
      expect(() => ProjectSchema.parse({ name: '   ', path: '/valid' })).toThrow(ZodError)
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

  describe('findProjectByPath', () => {
    it('returns undefined when projects directory is empty or does not exist', async () => {
      const nonExistent = path.join(tempProjectsDir, 'does-not-exist')
      expect(await findProjectByPath('/some/path', nonExistent)).toBeUndefined()
      expect(await findProjectByPath('/some/path', tempProjectsDir)).toBeUndefined()
    })

    it('returns project and slug when path matches', async () => {
      const projPath = path.join(tempProjectsDir, 'repo-a')
      await initProject({ name: 'Repo A', description: 'Description A', path: projPath }, tempProjectsDir)

      const found = await findProjectByPath(projPath, tempProjectsDir)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Repo A')
      expect(found?.description).toBe('Description A')
      expect(found?.path).toBe(path.resolve(projPath))
      expect(found?.slug).toBe('repo-a')
    })

    it('matches paths regardless of trailing slashes or relative segments', async () => {
      const projPath = path.join(tempProjectsDir, 'repo-b')
      await initProject({ name: 'Repo B', path: projPath }, tempProjectsDir)

      const withTrailingSlash = `${projPath}/`
      const withRelative = path.join(tempProjectsDir, 'sub', '..', 'repo-b')

      expect(await findProjectByPath(withTrailingSlash, tempProjectsDir)).toBeDefined()
      expect(await findProjectByPath(withRelative, tempProjectsDir)).toBeDefined()
    })
  })

  describe('listProjects', () => {
    it('returns empty array when projects directory does not exist or is empty', async () => {
      const nonExistent = path.join(tempProjectsDir, 'non-existent')
      expect(await listProjects(nonExistent)).toEqual([])
      expect(await listProjects(tempProjectsDir)).toEqual([])
    })

    it('returns all valid projects sorted alphabetically by slug', async () => {
      const pathZ = path.join(tempProjectsDir, 'z-dir')
      const pathA = path.join(tempProjectsDir, 'a-dir')
      const pathM = path.join(tempProjectsDir, 'm-dir')

      await initProject({ name: 'Zeta Project', description: 'Z desc', path: pathZ }, tempProjectsDir)
      await initProject({ name: 'Alpha Project', description: 'A desc', path: pathA }, tempProjectsDir)
      await initProject({ name: 'Mu Project', description: 'M desc', path: pathM }, tempProjectsDir)

      const projects = await listProjects(tempProjectsDir)
      expect(projects).toHaveLength(3)
      expect(projects.map(p => p.slug)).toEqual(['alpha-project', 'mu-project', 'zeta-project'])
      expect(projects[0]).toEqual({
        name: 'Alpha Project',
        description: 'A desc',
        path: path.resolve(pathA),
        slug: 'alpha-project',
      })
    })

    it('ignores invalid entries, non-directory files, and unreadable project files', async () => {
      const validPath = path.join(tempProjectsDir, 'valid-dir')
      await initProject({ name: 'Valid Project', path: validPath }, tempProjectsDir)

      // Plain file in projectsDir
      await writeFile(path.join(tempProjectsDir, 'stray-file.txt'), 'hello')

      // Directory without project.json
      await mkdir(path.join(tempProjectsDir, 'empty-dir'), { recursive: true })

      // Directory with corrupt project.json
      const corruptDir = path.join(tempProjectsDir, 'corrupt-dir')
      await mkdir(corruptDir, { recursive: true })
      await writeFile(path.join(corruptDir, 'project.json'), 'not json')

      const projects = await listProjects(tempProjectsDir)
      expect(projects).toHaveLength(1)
      expect(projects[0]?.slug).toBe('valid-project')
    })
  })

  describe('removeProjects', () => {
    it('removes target project directory without touching project.path', async () => {
      const projectSourceDir = await mkdtemp(path.join(os.tmpdir(), 'proj-source-'))
      await writeFile(path.join(projectSourceDir, 'README.md'), '# Original Code')

      const result = await initProject({
        name: 'Delete Me',
        description: 'Testing removal',
        path: projectSourceDir,
      }, tempProjectsDir)

      const projectFolder = path.join(tempProjectsDir, result.slug)
      const removed = await removeProjects([result.slug], tempProjectsDir)
      expect(removed).toEqual([result.slug])

      // Project folder inside projectsDir must be deleted
      await expect(readFile(path.join(projectFolder, 'project.json'), 'utf8')).rejects.toThrow()

      // Source directory must remain intact
      const sourceReadme = await readFile(path.join(projectSourceDir, 'README.md'), 'utf8')
      expect(sourceReadme).toBe('# Original Code')

      await rm(projectSourceDir, { force: true, recursive: true })
    })

    it('removes multiple projects and leaves unselected projects intact', async () => {
      const path1 = path.join(tempProjectsDir, 'dir1')
      const path2 = path.join(tempProjectsDir, 'dir2')
      const path3 = path.join(tempProjectsDir, 'dir3')

      await initProject({ name: 'Project One', path: path1 }, tempProjectsDir)
      await initProject({ name: 'Project Two', path: path2 }, tempProjectsDir)
      await initProject({ name: 'Project Three', path: path3 }, tempProjectsDir)

      const removed = await removeProjects(['project-one', 'project-three'], tempProjectsDir)
      expect(removed).toEqual(['project-one', 'project-three'])

      const remaining = await listProjects(tempProjectsDir)
      expect(remaining.map(p => p.slug)).toEqual(['project-two'])
    })

    it('throws error and leaves directories intact when a requested slug does not exist', async () => {
      const path1 = path.join(tempProjectsDir, 'dir1')
      await initProject({ name: 'Existing Project', path: path1 }, tempProjectsDir)

      await expect(
        removeProjects(['existing-project', 'non-existent-project'], tempProjectsDir),
      ).rejects.toThrow(/Project "non-existent-project" does not exist/)

      const remaining = await listProjects(tempProjectsDir)
      expect(remaining).toHaveLength(1)
    })

    it('throws error on invalid slug with traversal attempts', async () => {
      await expect(removeProjects(['..'], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
      await expect(removeProjects(['.'], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
      await expect(removeProjects(['../evil'], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
      await expect(removeProjects(['a/b'], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
      await expect(removeProjects(['/absolute/path'], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
      await expect(removeProjects([''], tempProjectsDir)).rejects.toThrow(/Invalid project slug/)
    })

    it('reports already-removed slugs when rm fails partway through', async () => {
      const p1 = path.join(tempProjectsDir, 'proj-1')
      const p2 = path.join(tempProjectsDir, 'proj-2')
      await initProject({ name: 'Proj 1', path: p1 }, tempProjectsDir)
      await initProject({ name: 'Proj 2', path: p2 }, tempProjectsDir)

      const failingRm = async (target: string, opts: { force: boolean, recursive: boolean }) => {
        if (target.endsWith('proj-2')) {
          throw new Error('EACCES: permission denied')
        }
        await rm(target, opts)
      }

      const error = await removeProjects(['proj-1', 'proj-2'], tempProjectsDir, failingRm).catch((err: unknown) => err)
      expect(error).toBeInstanceOf(RemoveProjectsError)
      expect((error as RemoveProjectsError).message).toContain('partially removed: proj-1')
      expect((error as RemoveProjectsError).removedSlugs).toEqual(['proj-1'])
    })
  })

  describe('initProject', () => {
    it('creates project.json with correct metadata and returns slug and path', async () => {
      const projPath = path.join(tempProjectsDir, 'my-project')
      const result = await initProject({
        name: 'My Project',
        description: 'First project',
        path: projPath,
      }, tempProjectsDir)

      expect(result.slug).toBe('my-project')
      expect(result.project.name).toBe('My Project')
      expect(result.project.description).toBe('First project')
      expect(result.project.path).toBe(path.resolve(projPath))
      expect(result.filePath).toBe(path.join(tempProjectsDir, 'my-project', 'project.json'))

      const fileContent = JSON.parse(await readFile(result.filePath, 'utf8'))
      expect(fileContent).toEqual({
        name: 'My Project',
        description: 'First project',
        path: path.resolve(projPath),
      })
    })

    it('throws error when path is already initialized', async () => {
      const projPath = path.join(tempProjectsDir, 'existing-repo')
      await initProject({ name: 'Initial', path: projPath }, tempProjectsDir)

      await expect(initProject({ name: 'Duplicate', path: projPath }, tempProjectsDir)).rejects.toThrow(
        /already initialized/,
      )
    })

    it('resolves collision by appending 8-char hash when slug exists for a different path', async () => {
      const path1 = path.join(tempProjectsDir, 'folder1')
      const path2 = path.join(tempProjectsDir, 'folder2')

      const first = await initProject({ name: 'Common Name', path: path1 }, tempProjectsDir)
      expect(first.slug).toBe('common-name')

      const second = await initProject({ name: 'Common Name', path: path2 }, tempProjectsDir)
      expect(second.slug).toMatch(/^common-name-[a-f0-9]{8}$/)
      expect(second.slug).not.toBe(first.slug)

      // Verify original project on disk was NOT overwritten
      const firstContent = JSON.parse(await readFile(first.filePath, 'utf8'))
      expect(firstContent.path).toBe(path.resolve(path1))

      const secondContent = JSON.parse(await readFile(second.filePath, 'utf8'))
      expect(secondContent.path).toBe(path.resolve(path2))
    })

    it('trims whitespace-only description to empty string', async () => {
      const projPath = path.join(tempProjectsDir, 'whitespace-desc')
      const result = await initProject({
        name: 'Whitespace Project',
        description: '   ',
        path: projPath,
      }, tempProjectsDir)

      expect(result.project.description).toBe('')
      const fileContent = JSON.parse(await readFile(result.filePath, 'utf8'))
      expect(fileContent.description).toBe('')
    })
  })
})
