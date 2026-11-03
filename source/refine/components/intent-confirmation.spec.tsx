import type { RefineIntent } from '../../store/task-store.js'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { pressKey, stripAnsi, submitAndWait } from '../../test-helpers.js'
import { IntentConfirmation } from './intent-confirmation.js'

describe('intentConfirmation component', () => {
  const sampleIntent: RefineIntent = {
    outcome: 'Build an onboarding wizard',
    user: 'CLI developers',
    whyNow: 'Improve adoption rate',
    success: 'Wizard finishes in 2 minutes',
    constraint: 'Zero external network dependencies',
    outOfScope: 'Web UI',
  }

  it('renders all 6 statement of intent fields with labels', () => {
    const { lastFrame } = render(
      <IntentConfirmation
        intent={sampleIntent}
        onConfirm={() => {}}
      />,
    )

    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('STATEMENT OF INTENT:')
    expect(frame).toContain('Outcome: Build an onboarding wizard')
    expect(frame).toContain('User: CLI developers')
    expect(frame).toContain('Why now: Improve adoption rate')
    expect(frame).toContain('Success: Wizard finishes in 2 minutes')
    expect(frame).toContain('Constraint: Zero external network dependencies')
    expect(frame).toContain('Out of scope: Web UI')
    expect(frame).toContain('Confirm intent? (Enter/y to confirm, or type refinement feedback):')
  })

  it('calls onConfirm when user submits confirmation input', async () => {
    const onConfirm = vi.fn()
    const { lastFrame, stdin } = render(
      <IntentConfirmation
        intent={sampleIntent}
        onConfirm={onConfirm}
      />,
    )

    await pressKey(stdin, 'yes')
    await vi.waitFor(() => {
      expect(lastFrame() ?? '').toContain('yes')
    })
    await submitAndWait(stdin, '\r', () => {
      expect(onConfirm).toHaveBeenCalledWith('yes')
    })
  })
})
