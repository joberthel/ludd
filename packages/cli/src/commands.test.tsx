import process from 'node:process'
import { render } from 'ink-testing-library'
import { afterEach, expect, it, vi } from 'vitest'
import Abort from './commands/abort.js'
import Gate from './commands/gate.js'
import Gc from './commands/gc.js'
import Resume from './commands/resume.js'
import Run from './commands/run.js'
import Status from './commands/status.js'
import Teardown from './commands/teardown.js'

const actions = vi.hoisted(() => ({
  run: vi.fn(async () => 0),
  resume: vi.fn(async () => 0),
  status: vi.fn(async () => 0),
  gate: vi.fn(async () => 0),
  abort: vi.fn(async () => 0),
  teardown: vi.fn(async () => 0),
  gc: vi.fn(async () => 0),
}))

vi.mock('./actions/run-command.js', () => ({ runCommand: actions.run }))
vi.mock('./actions/resume-command.js', () => ({ resumeCommand: actions.resume }))
vi.mock('./actions/status-command.js', () => ({ statusCommand: actions.status }))
vi.mock('./actions/gate-command.js', () => ({ gateCommand: actions.gate }))
vi.mock('./actions/abort-command.js', () => ({ abortCommand: actions.abort }))
vi.mock('./actions/teardown-command.js', () => ({ teardownCommand: actions.teardown }))
vi.mock('./actions/gc-command.js', () => ({ gcCommand: actions.gc }))

const originalExitCode = process.exitCode

afterEach(() => {
  process.exitCode = originalExitCode
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

it('dispatches run command with positional, named, default, and conflicting config options', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const first = render(
    <Run
      args={['flow.ts']}
      options={{
        runId: 'run-a',
        workspace: '/tmp/w',
        stream: true,
        detach: true,
      }}
    />,
  )
  await vi.waitFor(() => expect(actions.run).toHaveBeenCalledWith({
    configPath: 'flow.ts',
    runId: 'run-a',
    workspace: '/tmp/w',
    stream: true,
    detach: true,
  }))
  first.unmount()

  const second = render(<Run args={[undefined]} options={{ config: 'other.ts' }} />)
  await vi.waitFor(() => expect(actions.run).toHaveBeenLastCalledWith({ configPath: 'other.ts' }))
  second.unmount()

  const third = render(<Run args={[undefined]} options={{}} />)
  await vi.waitFor(() => expect(actions.run).toHaveBeenLastCalledWith({}))
  third.unmount()

  const conflict = render(<Run args={['a.ts']} options={{ config: 'b.ts' }} />)
  await vi.waitFor(() => expect(conflict.lastFrame()).toContain('not both'))
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('not both'))
  conflict.unmount()
})

it('dispatches resume and status commands', async () => {
  const r1 = render(<Resume args={['run-a']} options={{ workspace: '/w', stream: true, detach: true }} />)
  await vi.waitFor(() => expect(actions.resume).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/w',
    stream: true,
    detach: true,
  }))
  r1.unmount()

  const r2 = render(<Resume args={['run-b']} options={{}} />)
  await vi.waitFor(() => expect(actions.resume).toHaveBeenLastCalledWith({ runId: 'run-b' }))
  r2.unmount()

  const s1 = render(<Status args={[undefined]} options={{ workspace: '/w', json: true }} />)
  await vi.waitFor(() => expect(actions.status).toHaveBeenCalledWith({ workspace: '/w', json: true }))
  s1.unmount()

  const s2 = render(<Status args={['run-a']} options={{}} />)
  await vi.waitFor(() => expect(actions.status).toHaveBeenLastCalledWith({ runId: 'run-a' }))
  s2.unmount()
})

it('dispatches gate, abort, teardown, and gc commands', async () => {
  const g1 = render(
    <Gate
      args={['run-a']}
      options={{
        workspace: '/w',
        action: 'retry',
        feedback: 'More',
        addRetries: 2,
        answer: '7',
      }}
    />,
  )
  await vi.waitFor(() => expect(actions.gate).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/w',
    action: 'retry',
    feedback: 'More',
    addRetries: 2,
    answer: '7',
  }))
  g1.unmount()

  const g2 = render(<Gate args={['run-b']} options={{}} />)
  await vi.waitFor(() => expect(actions.gate).toHaveBeenLastCalledWith({ runId: 'run-b' }))
  g2.unmount()

  const a1 = render(<Abort args={['run-a']} options={{ workspace: '/w', reason: 'Stop', teardown: true }} />)
  await vi.waitFor(() => expect(actions.abort).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/w',
    reason: 'Stop',
    teardown: true,
  }))
  a1.unmount()

  const a2 = render(<Abort args={['run-b']} options={{}} />)
  await vi.waitFor(() => expect(actions.abort).toHaveBeenLastCalledWith({ runId: 'run-b' }))
  a2.unmount()
})

it('dispatches teardown and gc commands', async () => {
  const t1 = render(<Teardown args={['run-a']} options={{ workspace: '/w', force: true }} />)
  await vi.waitFor(() => expect(actions.teardown).toHaveBeenCalledWith({ runId: 'run-a', workspace: '/w', force: true }))
  t1.unmount()

  const t2 = render(<Teardown args={['run-b']} options={{}} />)
  await vi.waitFor(() => expect(actions.teardown).toHaveBeenLastCalledWith({ runId: 'run-b' }))
  t2.unmount()

  const c1 = render(
    <Gc
      args={['run-a']}
      options={{
        workspace: '/w',
        runId: ['run-b', 'run-c'],
        olderThan: '2h',
        status: ['passed'],
        dryRun: true,
      }}
    />,
  )
  await vi.waitFor(() => expect(actions.gc).toHaveBeenCalledWith({
    runId: ['run-a', 'run-b', 'run-c'],
    workspace: '/w',
    olderThan: '2h',
    status: ['passed'],
    dryRun: true,
  }))
  c1.unmount()

  const c2 = render(<Gc args={undefined} options={{}} />)
  await vi.waitFor(() => expect(actions.gc).toHaveBeenLastCalledWith({}))
  c2.unmount()
})
