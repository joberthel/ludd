import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunAlreadyActiveError } from '../../errors/run-already-active-error.js'
import { RUNNER_PID_FILE } from '../../persistence/pid-lock.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-harness-pid-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(tempDir, { recursive: true, force: true })
})

function getRunPaths(runId: string) {
  const runDir = path.join(tempDir, '.harness', 'runs', runId)
  return {
    runDir,
    pidFile: path.join(runDir, RUNNER_PID_FILE),
    stateFile: path.join(runDir, 'state.json'),
    ledgerFile: path.join(runDir, 'ledger.jsonl'),
  }
}

describe('runHarness pid-lock execution observability', () => {
  it('keeps runner.pid alive during step execution with process.pid (AC 2.4.1)', async () => {
    let observedPidContent: string | undefined
    const runId = 'live-pid-run'
    const { pidFile } = getRunPaths(runId)

    const result = await runHarness(
      {
        name: 'pid-lifecycle-harness',
        steps: [
          {
            id: 'observe-pid',
            run: async () => {
              expect(fs.existsSync(pidFile)).toBe(true)
              observedPidContent = fs.readFileSync(pidFile, 'utf-8')
              return 'done'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(observedPidContent?.trim()).toBe(String(process.pid))
  })
})

describe('runHarness pid-lock release on completion', () => {
  it('removes runner.pid on successful run completion (AC 2.4.2)', async () => {
    const runId = 'success-release-run'
    const { pidFile } = getRunPaths(runId)

    const result = await runHarness(
      {
        name: 'success-harness',
        steps: [
          {
            id: 'step-1',
            run: async () => 'ok',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it('removes runner.pid on failed run completion (AC 2.4.2)', async () => {
    const runId = 'failure-release-run'
    const { pidFile } = getRunPaths(runId)

    const result = await runHarness(
      {
        name: 'failing-harness',
        steps: [
          {
            id: 'fail-step',
            run: async () => {
              throw new Error('fatal step failure')
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('failed')
    expect(fs.existsSync(pidFile)).toBe(false)
  })
})

describe('runHarness split-brain prevention for live process', () => {
  it('throws RunAlreadyActiveError and leaves state/ledger untouched for live pid (AC 2.4.3)', async () => {
    const runId = 'active-lock-run'
    const { runDir, pidFile, stateFile, ledgerFile } = getRunPaths(runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf-8')

    await expect(
      runHarness(
        {
          name: 'locked-harness',
          steps: [
            {
              id: 's1',
              run: async () => 'ok',
            },
          ],
        },
        { runId, workspaceDir: tempDir },
      ),
    ).rejects.toThrow(RunAlreadyActiveError)

    expect(fs.existsSync(stateFile)).toBe(false)
    expect(fs.existsSync(ledgerFile)).toBe(false)
    expect(fs.readFileSync(pidFile, 'utf-8')).toBe(`${process.pid}\n`)
  })
})

describe('runHarness split-brain prevention for EPERM process', () => {
  it('throws RunAlreadyActiveError when runner.pid process throws EPERM (AC 2.4.3)', async () => {
    const runId = 'eperm-lock-run'
    const { runDir, pidFile, stateFile, ledgerFile } = getRunPaths(runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(pidFile, '12345\n', 'utf-8')

    const epermError = new Error('EPERM operation not permitted') as NodeJS.ErrnoException
    epermError.code = 'EPERM'
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw epermError
    })

    await expect(
      runHarness(
        {
          name: 'eperm-harness',
          steps: [
            {
              id: 's1',
              run: async () => 'ok',
            },
          ],
        },
        { runId, workspaceDir: tempDir },
      ),
    ).rejects.toThrow(RunAlreadyActiveError)

    expect(fs.existsSync(stateFile)).toBe(false)
    expect(fs.existsSync(ledgerFile)).toBe(false)
  })
})

describe('runHarness recovery from stale or corrupt pid files', () => {
  it('overwrites dead runner.pid and completes successfully (AC 2.4.4)', async () => {
    const runId = 'dead-lock-run'
    const { runDir, pidFile } = getRunPaths(runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(pidFile, '999999\n', 'utf-8')

    let observedPid: string | undefined
    const result = await runHarness(
      {
        name: 'stale-pid-harness',
        steps: [
          {
            id: 'check-overwritten',
            run: async () => {
              observedPid = fs.readFileSync(pidFile, 'utf-8')
              return 'recovered'
            },
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(observedPid?.trim()).toBe(String(process.pid))
    expect(fs.existsSync(pidFile)).toBe(false)
  })

  it('overwrites corrupt runner.pid and completes successfully (AC 2.4.4)', async () => {
    const runId = 'corrupt-lock-run'
    const { runDir, pidFile } = getRunPaths(runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(pidFile, 'invalid-corrupt-pid\n', 'utf-8')

    const result = await runHarness(
      {
        name: 'corrupt-pid-harness',
        steps: [
          {
            id: 's1',
            run: async () => 'fine',
          },
        ],
      },
      { runId, workspaceDir: tempDir },
    )

    expect(result.status).toBe('passed')
    expect(fs.existsSync(pidFile)).toBe(false)
  })
})
