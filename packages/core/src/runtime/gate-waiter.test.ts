import type { ActiveGateState } from '../types/state.js'
import { describe, expect, it } from 'vitest'
import { createGateWaiter } from './gate-waiter.js'

const sampleGate: ActiveGateState = {
  stepId: 'step-review',
  phase: 'beforeStep',
  guardrailIndex: 0,
  gateType: 'human_review',
  prompt: 'Please approve or provide feedback',
  createdAt: new Date().toISOString(),
}

describe('createGateWaiter state and resolution', () => {
  it('initializes with no active gate', () => {
    const waiter = createGateWaiter()
    expect(waiter.getActiveGate()).toBeNull()
    expect(waiter.isWaiting()).toBe(false)
  })

  it('no-ops safely when resolving or aborting with no gate waiting', () => {
    const waiter = createGateWaiter()
    expect(() => waiter.resolve({ stepId: 'step-1', action: 'pass' })).not.toThrow()
    expect(() => waiter.abort('test')).not.toThrow()
    expect(waiter.isWaiting()).toBe(false)
  })

  it('registers active gate and resolves with resolution params', async () => {
    const waiter = createGateWaiter()
    const waitPromise = waiter.waitForResolution(sampleGate)

    expect(waiter.isWaiting()).toBe(true)
    expect(waiter.getActiveGate()).toEqual(sampleGate)

    waiter.resolve({
      stepId: 'step-review',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved with notes',
    })

    const result = await waitPromise
    expect(result).toEqual({
      stepId: 'step-review',
      guardrailIndex: 0,
      action: 'pass',
      feedback: 'Approved with notes',
    })
    expect(waiter.isWaiting()).toBe(false)
    expect(waiter.getActiveGate()).toBeNull()
  })
})

describe('createGateWaiter abort and concurrency', () => {
  it('rejects waiting promise when abort is invoked with custom reason', async () => {
    const waiter = createGateWaiter()
    const waitPromise = waiter.waitForResolution(sampleGate)

    waiter.abort('User cancelled the workflow run')

    await expect(waitPromise).rejects.toThrow('User cancelled the workflow run')
    expect(waiter.isWaiting()).toBe(false)
    expect(waiter.getActiveGate()).toBeNull()
  })

  it('rejects waiting promise with default message when aborted without reason', async () => {
    const waiter = createGateWaiter()
    const waitPromise = waiter.waitForResolution(sampleGate)

    waiter.abort()

    await expect(waitPromise).rejects.toThrow('Gate resolution aborted')
    expect(waiter.isWaiting()).toBe(false)
    expect(waiter.getActiveGate()).toBeNull()
  })

  it('throws an error if a second gate attempts to wait simultaneously', async () => {
    const waiter = createGateWaiter()
    void waiter.waitForResolution(sampleGate)

    await expect(waiter.waitForResolution({
      ...sampleGate,
      stepId: 'step-other',
    })).rejects.toThrow('A gate is already waiting for resolution: step-review (index 0)')
  })

  it('allows subsequent gates after the previous one was resolved', async () => {
    const waiter = createGateWaiter()
    const p1 = waiter.waitForResolution(sampleGate)
    waiter.resolve({ stepId: 'step-review', action: 'pass' })
    await p1

    const secondGate: ActiveGateState = {
      stepId: 'step-2',
      phase: 'beforeStep',
      guardrailIndex: 1,
      gateType: 'human_review',
      prompt: 'Second gate prompt',
      createdAt: new Date().toISOString(),
    }
    const p2 = waiter.waitForResolution(secondGate)
    expect(waiter.getActiveGate()?.stepId).toBe('step-2')
    waiter.resolve({ stepId: 'step-2', action: 'skip' })
    const res2 = await p2
    expect(res2.action).toBe('skip')
  })
})

describe('createGateWaiter AbortSignal support', () => {
  it('aborts waiting promise when defaultSignal aborts', async () => {
    const controller = new AbortController()
    const waiter = createGateWaiter(controller.signal)
    const waitPromise = waiter.waitForResolution(sampleGate)

    controller.abort('Controller aborted')
    await expect(waitPromise).rejects.toThrow('Controller aborted')
    expect(waiter.isWaiting()).toBe(false)
  })

  it('aborts waiting promise with default message when aborted without reason', async () => {
    const controller = new AbortController()
    const waiter = createGateWaiter(controller.signal)
    const waitPromise = waiter.waitForResolution(sampleGate)

    controller.abort()
    await expect(waitPromise).rejects.toThrow('This operation was aborted')
  })

  it('aborts waiting promise with error message when aborted with Error reason', async () => {
    const controller = new AbortController()
    const waiter = createGateWaiter(controller.signal)
    const waitPromise = waiter.waitForResolution(sampleGate)

    controller.abort(new Error('Controller error reason'))
    await expect(waitPromise).rejects.toThrow('Controller error reason')
  })

  it('rejects immediately when defaultSignal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Already aborted error'))
    const waiter = createGateWaiter(controller.signal)

    await expect(waiter.waitForResolution(sampleGate)).rejects.toThrow('Already aborted error')
  })

  it('aborts waiting promise when per-call signal aborts', async () => {
    const waiter = createGateWaiter()
    const controller = new AbortController()
    const waitPromise = waiter.waitForResolution(sampleGate, controller.signal)

    controller.abort('Per-call abort')
    await expect(waitPromise).rejects.toThrow('Per-call abort')
  })

  it('rejects immediately when per-call signal is already aborted', async () => {
    const waiter = createGateWaiter()
    const controller = new AbortController()
    controller.abort('Pre-aborted call')

    await expect(waiter.waitForResolution(sampleGate, controller.signal)).rejects.toThrow('Pre-aborted call')
  })

  it('falls back to default message when signal reason is neither string nor Error', async () => {
    const waiter = createGateWaiter()
    const fakeSignal = { aborted: true, reason: 123 } as unknown as AbortSignal
    await expect(waiter.waitForResolution(sampleGate, fakeSignal)).rejects.toThrow('Gate resolution aborted')
  })
})
