import type { RunStateSnapshot } from '@ludd/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createControlClient, isProcessAlive, readRunState, resolveRunDir, RUNNER_PID_FILE } from '@ludd/core'

export interface StatusCommandOptions { runId?: string, workspace?: string, json?: boolean }

function processInfo(runDir: string): { alive: boolean, pid?: number } {
  const file = path.join(runDir, RUNNER_PID_FILE)
  if (!fs.existsSync(file))
    return { alive: false }
  const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
  return isProcessAlive(pid)
    ? { alive: true, pid }
    : { alive: false }
}

function overviewRow(runId: string, runDir: string, state: RunStateSnapshot) {
  const proc = processInfo(runDir)
  return {
    runId,
    workflow: state.workflowName,
    config: state.configPath ?? '-',
    status: state.status,
    process: proc.alive
      ? `alive (${proc.pid})`
      : 'stopped',
    activeStep: state.activeStepId ?? '-',
    gate: state.activeGate?.gateType ?? '-',
  }
}

function printTable(rows: ReturnType<typeof overviewRow>[]): void {
  const columns = [
    ['RUN ID', 'runId'],
    ['WORKFLOW', 'workflow'],
    ['CONFIG', 'config'],
    ['STATUS', 'status'],
    ['PROCESS', 'process'],
    ['ACTIVE STEP', 'activeStep'],
    ['GATE', 'gate'],
  ] as const
  const widths = columns.map(([title, key]) => Math.max(title.length, ...rows.map(row => String(row[key]).length)))
  console.log(columns.map(([title], i) => title.padEnd(widths[i])).join('  '))
  for (const row of rows)
    console.log(columns.map(([, key], i) => String(row[key]).padEnd(widths[i])).join('  '))
}

export async function statusCommand(options: StatusCommandOptions): Promise<number> {
  const workspace = path.resolve(options.workspace ?? process.cwd())
  const runsDir = path.join(workspace, '.harness', 'runs')
  if (options.runId === undefined || options.runId.length === 0) {
    const rows: ReturnType<typeof overviewRow>[] = []
    for (const entry of fs.existsSync(runsDir)
      ? fs.readdirSync(runsDir, { withFileTypes: true })
      : []) {
      if (!entry.isDirectory())
        continue
      const runDir = path.join(runsDir, entry.name)
      const stateFile = path.join(runDir, 'state.json')
      if (!fs.existsSync(stateFile))
        continue
      try {
        rows.push(overviewRow(entry.name, runDir, readRunState(runDir)))
      }
      catch { /* Ignore incomplete or invalid run directories. */ }
    }
    if (options.json)
      console.log(JSON.stringify(rows, null, 2))
    else printTable(rows)
    return 0
  }

  const runDir = resolveRunDir(workspace, options.runId)
  const stateFile = path.join(runDir, 'state.json')
  if (!fs.existsSync(stateFile))
    throw new Error(`Run "${options.runId}" was not found.`)
  let state = readRunState(runDir)
  const proc = processInfo(runDir)
  const sockPath = path.join(runDir, 'control.sock')
  if (proc.alive && fs.existsSync(sockPath)) {
    try {
      const client = await createControlClient(runDir)
      try {
        state = await client.status()
      }
      finally {
        await client.close()
      }
    }
    catch { /* A live PID may be in startup/shutdown; persisted state remains authoritative fallback. */ }
  }
  const detail = {
    ...overviewRow(options.runId, runDir, state),
    activeGate: state.activeGate ?? null,
    steps: state.steps,
    activeMatrixIndex: state.activeMatrixIndex ?? null,
    environments: state.environments ?? {},
    updatedAt: state.updatedAt,
  }
  if (options.json) {
    console.log(JSON.stringify(detail, null, 2))
  }
  else {
    console.log(`Run: ${options.runId}\nWorkflow: ${state.workflowName}\nConfig: ${state.configPath ?? '-'}\nStatus: ${state.status}\nProcess: ${detail.process}\nActive step: ${detail.activeStep}`)
    console.log('Steps:')
    for (const [id, result] of Object.entries(state.steps)) {
      console.log(`  ${id}: ${result.status}`)
    }
    if (state.activeMatrixIndex !== undefined && state.activeMatrixIndex !== null)
      console.log(`Matrix cursor: ${state.activeMatrixIndex + 1}`)
    console.log('Environments:')
    for (const [id, env] of Object.entries(state.environments ?? {})) {
      console.log(`  ${id}: ${env.type} (${env.workingDir})`)
    }
    if (state.activeGate)
      console.log(`\nGate (${state.activeGate.gateType}):\n${state.activeGate.prompt}`)
  }
  return 0
}
