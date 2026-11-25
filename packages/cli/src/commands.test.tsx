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
import { getRunUiHost } from './ui/run-ui-bridge.js'

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

it('dispatches gate and abort commands', async () => {
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
  const t1 = render(<Teardown args={['run-a']} options={{ workspace: '/w', config: 'custom.config.ts', force: true }} />)
  await vi.waitFor(() => expect(actions.teardown).toHaveBeenCalledWith({
    runId: 'run-a',
    workspace: '/w',
    configPath: 'custom.config.ts',
    force: true,
  }))
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

it('enables dashboard mode for foreground Run and Resume unless --stream or --detach is set', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    actions.run.mockImplementation(async () => new Promise<number>(() => {}))
    const fgRun = render(<Run args={[undefined]} options={{}} />)
    await vi.waitFor(() => expect(fgRun.lastFrame()).toContain('Steps'))
    fgRun.unmount()

    const streamRun = render(<Run args={[undefined]} options={{ stream: true }} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(streamRun.lastFrame()).not.toContain('Steps')
    streamRun.unmount()

    actions.resume.mockImplementation(async () => new Promise<number>(() => {}))
    const detachResume = render(<Resume args={['run-a']} options={{ detach: true }} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(detachResume.lastFrame()).not.toContain('Steps')
    detachResume.unmount()

    const fgResume = render(<Resume args={['run-a']} options={{}} />)
    await vi.waitFor(() => expect(fgResume.lastFrame()).toContain('Steps'))
    fgResume.unmount()
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?1049h\x1B[2J\x1B[H')
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})

it('keeps Run and Resume dashboard open by default on finish and auto-exits when autoExit is true', async () => {
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    actions.run.mockImplementation(async () => {
      getRunUiHost()?.setBlueprint?.({
        harnessName: 'run-flow',
        steps: [
          { id: 's1', hasMatrix: false },
        ],
      })
      getRunUiHost()?.pushEntry({
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      })
      return 0
    })

    const stayOpenRun = render(<Run args={[undefined]} options={{}} />)
    await vi.waitFor(() => {
      expect(stayOpenRun.lastFrame()).toContain('q/Esc: exit')
    })
    stayOpenRun.unmount()

    const autoExitRun = render(<Run args={[undefined]} options={{ autoExit: true }} />)
    await vi.waitFor(() => {
      expect(autoExitRun.lastFrame()).toContain('✔ run-flow — Run passed')
    })
    autoExitRun.unmount()

    actions.resume.mockImplementation(async () => {
      getRunUiHost()?.setBlueprint?.({
        harnessName: 'resume-flow',
        steps: [
          { id: 's1', hasMatrix: false },
        ],
      })
      getRunUiHost()?.pushEntry({
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      })
      return 0
    })

    const stayOpenResume = render(<Resume args={['run-a']} options={{}} />)
    await vi.waitFor(() => {
      expect(stayOpenResume.lastFrame()).toContain('q/Esc: exit')
    })
    stayOpenResume.unmount()

    const autoExitResume = render(<Resume args={['run-a']} options={{ autoExit: true }} />)
    await vi.waitFor(() => {
      expect(autoExitResume.lastFrame()).toContain('✔ resume-flow — Run passed')
    })
    autoExitResume.unmount()
  }
  finally {
    if (origTty)
      Object.defineProperty(process.stdout, 'isTTY', origTty)
    else
      delete (process.stdout as { isTTY?: boolean }).isTTY
  }
})
