import type { HarnessRunResult } from '../src/index.js'
import type { FakePi } from './epic-08-fake-pi.js'
import cp from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLedgerEvents, readRunState, resolveRunDir, runHarness } from '../src/index.js'
import { waitForGateAndResolve } from './epic-06-client.js'
import { createFakePi } from './epic-08-fake-pi.js'
import { createReferenceHarness } from './fixtures/reference-harness.config.js'

let tempDir: string
let workspaceDir: string
let remoteDir: string

function git(cwd: string, ...args: string[]): string {
  return cp.execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

function initFixtureRepo(): void {
  git(workspaceDir, 'init', '-b', 'main')
  git(workspaceDir, 'config', 'user.name', 'Ludd E2E')
  git(workspaceDir, 'config', 'user.email', 'e2e@ludd.dev')
  fs.mkdirSync(path.join(workspaceDir, 'src'))
  fs.writeFileSync(path.join(workspaceDir, 'src', 'index.js'), '// fixture\n')
  fs.writeFileSync(path.join(workspaceDir, 'test.js'), 'require("./src/index.js")\n')
  fs.writeFileSync(path.join(workspaceDir, '.gitignore'), '.harness/\n')
  git(workspaceDir, 'add', '-A')
  git(workspaceDir, 'commit', '-m', 'chore: initial commit')
  git(tempDir, 'init', '--bare', remoteDir)
  git(workspaceDir, 'remote', 'add', 'origin', remoteDir)
}

async function driveHumanGates(runDir: string): Promise<void> {
  await waitForGateAndResolve(runDir, {
    stepId: 'triage-and-grilling',
    phase: 'beforeStep',
    action: 'pass',
    feedback: 'Add a greeting feature',
  })
  await waitForGateAndResolve(runDir, {
    stepId: 'triage-and-grilling',
    phase: 'afterStep',
    action: 'fail',
    feedback: 'English please',
  })
  await waitForGateAndResolve(runDir, { stepId: 'triage-and-grilling', phase: 'afterStep', action: 'pass' })
  await waitForGateAndResolve(runDir, { stepId: 'generate-spec-and-todos', phase: 'afterStep', action: 'pass' })
  await waitForGateAndResolve(runDir, { stepId: 'final-review-and-pr', phase: 'afterStep', action: 'pass' })
}

function assertAgentTurns(fake: FakePi): void {
  // Session continuity: the clarification retry reuses the triage Pi session file.
  const triage = fake.records.filter(r => r.prompt.includes('Feature-Wunsch'))
  expect(triage).toHaveLength(2)
  expect(triage[1]?.sessionFile).toBe(triage[0]?.sessionFile)
  expect(triage[1]?.prompt).toContain('English please')
  const spec = fake.records.find(r => r.prompt.includes('spec.md'))
  expect(spec?.sessionFile).toBe(triage[0]?.sessionFile)
  expect(fs.existsSync(triage[0]?.sessionFile ?? '')).toBe(true)

  // Modes and per-step tooling.
  expect(triage[0]?.mode).toBe('read-only')
  expect(triage[0]?.toolNames).toContain('submit_step_output')
  expect(spec?.toolNames).toContain('put_artifact')
  const slices = fake.records.filter(r => r.prompt.includes('To-Do-Slice'))
  expect(slices.map(r => r.mode)).toEqual(['workspace-write', 'workspace-write'])
  expect(slices[0]?.prompt).toContain('(1/2)')
  expect(slices[1]?.prompt).toContain('(2/2)')
  const reviews = fake.records.filter(r => r.prompt.includes('Git-Diff'))
  expect(reviews).toHaveLength(2)
  expect(reviews.every(r => r.mode === 'read-only')).toBe(true)
}

function assertGitHistory(workspaceDir: string, runId: string, remoteDir: string): void {
  // Git history in the worktree and the pushed branch on the bare remote.
  const worktreeDir = path.join(workspaceDir, '.harness', 'worktrees', `${runId}-feature-env`)
  expect(git(worktreeDir, 'log', '--format=%s').split('\n')).toEqual([
    'feat: implement slice 2',
    'feat: implement slice 1',
    'chore: initial commit',
  ])
  expect(git(worktreeDir, 'status', '--porcelain')).toBe('')
  const branch = git(worktreeDir, 'rev-parse', '--abbrev-ref', 'HEAD')
  expect(branch).not.toBe('main')
  expect(git(remoteDir, 'rev-parse', branch)).toBe(git(worktreeDir, 'rev-parse', 'HEAD'))
  expect(git(workspaceDir, 'log', '--format=%s', 'main')).toBe('chore: initial commit')
}

function assertPersistence(runDir: string, result: HarnessRunResult): void {
  // Persistence: state.json, ledger.jsonl, streams, MCP artifacts.
  const state = readRunState(runDir)
  expect(state.status).toBe('passed')
  expect(state.activeGate).toBeNull()
  expect(fs.existsSync(path.join(runDir, 'state.json'))).toBe(true)
  const types = readLedgerEvents(runDir).map(e => e.eventType)
  expect(types).toEqual(expect.arrayContaining([
    'gate.waiting',
    'gate.resolved',
    'guardrail.passed',
    'agent.stream.linked',
    'run.passed',
  ]))
  const sessionId = (result.steps['triage-and-grilling']?.output as { sessionId: string }).sessionId
  const stream = fs.readFileSync(path.join(runDir, 'streams', `${sessionId}.jsonl`), 'utf-8')
  expect(stream).toContain('turn.started')
  expect(stream).toContain('message_chunk')
  expect(fs.readdirSync(path.join(runDir, 'streams')).length).toBeGreaterThanOrEqual(4)
  const artifactFiles = fs.readdirSync(runDir, { recursive: true }).map(String)
  for (const name of ['spec.md', 'todos.json', 'pr-description.md']) {
    expect(artifactFiles.some(f => f.endsWith(name))).toBe(true)
  }
}

describe('epic 8 E2E reference workflow (TDD 9.2) with scripted Pi session', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-e2e-epic8-'))
    workspaceDir = path.join(tempDir, 'workspace')
    remoteDir = path.join(tempDir, 'remote.git')
    fs.mkdirSync(workspaceDir)
    initFixtureRepo()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('runs triage, spec, per-slice implement/verify/commit and pushes to the bare remote', async () => {
    const fake = createFakePi()
    const runId = 'e2e-epic-08-reference'
    const runDir = resolveRunDir(workspaceDir, runId)
    const harness = createReferenceHarness({ sessionFactory: fake.factory })

    const runPromise = runHarness(harness, { runId, workspaceDir })
    await driveHumanGates(runDir)
    const result = await runPromise

    expect(result.status).toBe('passed')
    for (const id of [
      'triage-and-grilling',
      'generate-spec-and-todos',
      'implement-slices',
      'final-review-and-pr',
    ]) {
      expect(result.steps[id]?.status).toBe('passed')
    }

    assertAgentTurns(fake)
    assertGitHistory(workspaceDir, runId, remoteDir)
    assertPersistence(runDir, result)
  })
})
