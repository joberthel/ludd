import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { initProject } from './project-store.js'
import {
  createTask,
  listTasks,
  parseTaskId,
  removeTasks,
  RemoveTasksError,
  resolveTaskIds,
  slugifyBranchName,
  TaskSchema,
  TaskStatusSchema,
} from './task-store.js'

describe('taskStore', () => {
  let tempProjectsDir: string
  let tempWorkDir: string

  beforeEach(async () => {
    tempProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-tasks-test-proj-'))
    tempWorkDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-tasks-test-work-'))
  })

  afterEach(async () => {
    await rm(tempProjectsDir, { force: true, recursive: true })
    await rm(tempWorkDir, { force: true, recursive: true })
  })

  describe('taskStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(TaskStatusSchema.parse('refinement')).toBe('refinement')
      expect(TaskStatusSchema.parse('todo')).toBe('todo')
      expect(TaskStatusSchema.parse('in_progress')).toBe('in_progress')
      expect(TaskStatusSchema.parse('done')).toBe('done')
    })

    it('rejects invalid statuses', () => {
      expect(() => TaskStatusSchema.parse('unknown')).toThrow(ZodError)
      expect(() => TaskStatusSchema.parse('')).toThrow(ZodError)
    })
  })

  describe('taskSchema', () => {
    it('validates a complete task object', () => {
      const task = {
        id: 1,
        name: 'Set up auth',
        branch: 'setup-auth',
        status: 'todo',
      }
      expect(TaskSchema.parse(task)).toEqual(task)
    })

    it('defaults status to refinement', () => {
      const task = {
        id: 2,
        name: 'Design DB',
        branch: 'design-db',
      }
      const parsed = TaskSchema.parse(task)
      expect(parsed.status).toBe('refinement')
    })

    it('rejects non-positive or non-integer id', () => {
      expect(() => TaskSchema.parse({ id: 0, name: 'Task', branch: 'task' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: -1, name: 'Task', branch: 'task' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1.5, name: 'Task', branch: 'task' })).toThrow(ZodError)
    })

    it('rejects empty or whitespace-only name and branch', () => {
      expect(() => TaskSchema.parse({ id: 1, name: '', branch: 'b' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: '   ', branch: 'b' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: '' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: '   ' })).toThrow(ZodError)
    })

    it('rejects unknown keys due to strict()', () => {
      expect(() => TaskSchema.parse({
        id: 1,
        name: 'Task',
        branch: 'branch',
        extra: 'disallowed',
      })).toThrow(ZodError)
    })

    it('rejects invalid branch names violating git ref format', () => {
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: 'foo bar' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: 'a..b' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: 'foo/' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: 'foo.lock' })).toThrow(ZodError)
      expect(() => TaskSchema.parse({ id: 1, name: 'Task', branch: 'foo~1' })).toThrow(ZodError)
    })
  })

  describe('slugifyBranchName', () => {
    it('converts titles to kebab-case branch names', () => {
      expect(slugifyBranchName('Implement Task Store!')).toBe('implement-task-store')
      expect(slugifyBranchName('Fix Issue #42: Login Bug')).toBe('fix-issue-42-login-bug')
    })

    it('normalizes unicode characters such as umlauts and accents', () => {
      expect(slugifyBranchName('Größe ändern')).toBe('grosse-andern')
      expect(slugifyBranchName('Café crème')).toBe('cafe-creme')
    })

    it('falls back to "task" when input contains no alphanumeric characters', () => {
      expect(slugifyBranchName('???')).toBe('task')
      expect(slugifyBranchName('   ')).toBe('task')
    })
  })

  describe('parseTaskId', () => {
    it('parses numeric values and strings with or without hash prefix', () => {
      expect(parseTaskId(1)).toBe(1)
      expect(parseTaskId('1')).toBe(1)
      expect(parseTaskId('#1')).toBe(1)
      expect(parseTaskId('  #42  ')).toBe(42)
      expect(parseTaskId('100')).toBe(100)
    })

    it('throws on invalid task IDs', () => {
      expect(() => parseTaskId(0)).toThrow('Invalid task ID "0"')
      expect(() => parseTaskId('0')).toThrow('Invalid task ID "0"')
      expect(() => parseTaskId('#0')).toThrow('Invalid task ID "#0"')
      expect(() => parseTaskId(-5)).toThrow('Invalid task ID "-5"')
      expect(() => parseTaskId('-5')).toThrow('Invalid task ID "-5"')
      expect(() => parseTaskId('abc')).toThrow('Invalid task ID "abc"')
      expect(() => parseTaskId('1.5')).toThrow('Invalid task ID "1.5"')
      expect(() => parseTaskId('..')).toThrow('Invalid task ID ".."')
      expect(() => parseTaskId('')).toThrow('Invalid task ID ""')
    })
  })

  describe('createTask', () => {
    it('increments taskCounter in project.json and writes task.json', async () => {
      const { slug } = await initProject({
        name: 'Demo Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      const result1 = await createTask({
        projectSlug: slug,
        name: 'First Task',
      }, tempProjectsDir)

      expect(result1.task.id).toBe(1)
      expect(result1.task.name).toBe('First Task')
      expect(result1.task.branch).toBe('first-task')
      expect(result1.task.status).toBe('refinement')
      expect(result1.project.taskCounter).toBe(1)

      const projectJson1 = JSON.parse(
        await readFile(path.join(tempProjectsDir, slug, 'project.json'), 'utf8'),
      )
      expect(projectJson1.taskCounter).toBe(1)

      const taskJson1 = JSON.parse(await readFile(result1.filePath, 'utf8'))
      expect(taskJson1).toEqual({
        id: 1,
        name: 'First Task',
        branch: 'first-task',
        status: 'refinement',
      })

      // Second task
      const result2 = await createTask({
        projectSlug: slug,
        name: 'Second Task',
        branch: 'custom-branch-name',
      }, tempProjectsDir)

      expect(result2.task.id).toBe(2)
      expect(result2.task.branch).toBe('custom-branch-name')
      expect(result2.project.taskCounter).toBe(2)

      const projectJson2 = JSON.parse(
        await readFile(path.join(tempProjectsDir, slug, 'project.json'), 'utf8'),
      )
      expect(projectJson2.taskCounter).toBe(2)
    })

    it('works with legacy project.json that lacks taskCounter field', async () => {
      const projDir = path.join(tempProjectsDir, 'legacy-proj')
      await mkdir(projDir, { recursive: true })
      await writeFile(
        path.join(projDir, 'project.json'),
        JSON.stringify({
          name: 'Legacy Project',
          description: '',
          path: tempWorkDir,
        }),
      )

      const result = await createTask({
        projectSlug: 'legacy-proj',
        name: 'Upgraded Task',
      }, tempProjectsDir)

      expect(result.task.id).toBe(1)
      expect(result.project.taskCounter).toBe(1)
    })

    it('throws error when project does not exist', async () => {
      await expect(createTask({
        projectSlug: 'non-existent',
        name: 'Some Task',
      }, tempProjectsDir)).rejects.toThrow('Project "non-existent" does not exist')
    })

    it('throws error on invalid slug or empty task name', async () => {
      const { slug } = await initProject({
        name: 'Valid Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      await expect(createTask({
        projectSlug: '../traversal',
        name: 'Some Task',
      }, tempProjectsDir)).rejects.toThrow('Invalid project slug "../traversal"')

      await expect(createTask({
        projectSlug: slug,
        name: '   ',
      }, tempProjectsDir)).rejects.toThrow('Task name cannot be empty')
    })

    it('allocates distinct IDs and creates all files under concurrent execution', async () => {
      const { slug } = await initProject({
        name: 'Concurrent Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      const concurrency = 8
      const tasks = await Promise.all(
        Array.from({ length: concurrency }, async (_, i) =>
          createTask({
            projectSlug: slug,
            name: `Concurrent Task ${i + 1}`,
          }, tempProjectsDir)),
      )

      const ids = tasks.map(t => t.task.id).sort((a, b) => a - b)
      expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

      const list = await listTasks(slug, tempProjectsDir)
      expect(list).toHaveLength(concurrency)
      expect(list.map(t => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

      const projectJson = JSON.parse(
        await readFile(path.join(tempProjectsDir, slug, 'project.json'), 'utf8'),
      )
      expect(projectJson.taskCounter).toBe(concurrency)
    })
  })

  describe('listTasks', () => {
    it('returns empty array when tasks directory does not exist or is empty', async () => {
      const { slug } = await initProject({
        name: 'Empty Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      expect(await listTasks(slug, tempProjectsDir)).toEqual([])
      expect(await listTasks('non-existent', tempProjectsDir)).toEqual([])
    })

    it('returns tasks sorted numerically ascending by ID (including 10+ tasks)', async () => {
      const { slug } = await initProject({
        name: 'Multi Tasks',
        path: tempWorkDir,
      }, tempProjectsDir)

      for (let i = 1; i <= 12; i++) {
        await createTask({
          projectSlug: slug,
          name: `Task Number ${i}`,
        }, tempProjectsDir)
      }

      const tasks = await listTasks(slug, tempProjectsDir)
      expect(tasks).toHaveLength(12)
      expect(tasks.map(t => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      expect(tasks[9]?.id).toBe(10)
    })

    it('ignores invalid directories or corrupted task files', async () => {
      const { slug } = await initProject({
        name: 'Corrupt Tasks',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Valid Task' }, tempProjectsDir)

      // Add corrupt task file and non-task file
      const tasksDir = path.join(tempProjectsDir, slug, 'tasks')
      const corruptDir = path.join(tasksDir, '999')
      await mkdir(corruptDir, { recursive: true })
      await writeFile(path.join(corruptDir, 'task.json'), 'not valid json')
      await writeFile(path.join(tasksDir, 'random.txt'), 'hello')

      const tasks = await listTasks(slug, tempProjectsDir)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.id).toBe(1)
    })
  })

  describe('removeTasks', () => {
    it('removes single task directory and leaves others and taskCounter intact', async () => {
      const { slug } = await initProject({
        name: 'Rm Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 3' }, tempProjectsDir)

      const removed = await removeTasks(slug, ['#2'], tempProjectsDir)
      expect(removed).toEqual([2])

      const remaining = await listTasks(slug, tempProjectsDir)
      expect(remaining.map(t => t.id)).toEqual([1, 3])

      // Verify task 2 directory was deleted
      const task2Dir = path.join(tempProjectsDir, slug, 'tasks', '2')
      await expect(readFile(path.join(task2Dir, 'task.json'))).rejects.toThrow()

      // Counter was not decremented; next task gets ID 4
      const nextTask = await createTask({ projectSlug: slug, name: 'Task 4' }, tempProjectsDir)
      expect(nextTask.task.id).toBe(4)
    })

    it('removes multiple tasks and deduplicates IDs in order', async () => {
      const { slug } = await initProject({
        name: 'Rm Multi',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 3' }, tempProjectsDir)

      const removed = await removeTasks(slug, [3, '1', '#3'], tempProjectsDir)
      expect(removed).toEqual([3, 1])

      const remaining = await listTasks(slug, tempProjectsDir)
      expect(remaining.map(t => t.id)).toEqual([2])
    })

    it('returns empty array when passed empty ID list', async () => {
      const { slug } = await initProject({
        name: 'Empty Rm',
        path: tempWorkDir,
      }, tempProjectsDir)

      expect(await removeTasks(slug, [], tempProjectsDir)).toEqual([])
    })

    it('throws error when project does not exist', async () => {
      await expect(removeTasks('non-existent', [1], tempProjectsDir))
        .rejects
        .toThrow('Project "non-existent" does not exist')
    })

    it('validates all target IDs exist up front before deleting any directory', async () => {
      const { slug } = await initProject({
        name: 'Atomic Rm',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)

      // Task 99 does not exist; task 1 must NOT be deleted
      await expect(removeTasks(slug, [1, 99], tempProjectsDir))
        .rejects
        .toThrow('Task #99 does not exist in project "atomic-rm"')

      const remaining = await listTasks(slug, tempProjectsDir)
      expect(remaining.map(t => t.id)).toEqual([1, 2])
    })

    it('throws RemoveTasksError with removedIds if rmFn fails partway through', async () => {
      const { slug } = await initProject({
        name: 'Fail Rm',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Task 1' }, tempProjectsDir)
      await createTask({ projectSlug: slug, name: 'Task 2' }, tempProjectsDir)

      const failingRm = async (target: string, options: { force: boolean, recursive: boolean }) => {
        if (target.endsWith(path.join('tasks', '2'))) {
          throw new Error('Disk error')
        }
        await rm(target, options)
      }

      let caughtError: unknown
      try {
        await removeTasks(slug, [1, 2], tempProjectsDir, failingRm)
      }
      catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(RemoveTasksError)
      const error = caughtError as RemoveTasksError
      expect(error.removedIds).toEqual([1])
      expect(error.message).toContain('partially removed: #1')
      expect(error.message).toContain('Disk error')
    })
  })

  describe('resolveTaskIds', () => {
    it('reports corrupt tasks when task.json is corrupted or missing', async () => {
      const { slug } = await initProject({
        name: 'Corrupt Resolve Project',
        path: tempWorkDir,
      }, tempProjectsDir)

      await createTask({ projectSlug: slug, name: 'Valid' }, tempProjectsDir)

      const corruptDir = path.join(tempProjectsDir, slug, 'tasks', '2')
      await mkdir(corruptDir, { recursive: true })
      await writeFile(path.join(corruptDir, 'task.json'), 'bad json')

      await expect(resolveTaskIds(slug, [1, 2], tempProjectsDir))
        .rejects
        .toThrow('Task #2 in project "corrupt-resolve-project" is corrupt')

      const missingJsonDir = path.join(tempProjectsDir, slug, 'tasks', '3')
      await mkdir(missingJsonDir, { recursive: true })

      await expect(resolveTaskIds(slug, [1, 3], tempProjectsDir))
        .rejects
        .toThrow('Task #3 in project "corrupt-resolve-project" is corrupt (missing task.json)')
    })
  })
})
