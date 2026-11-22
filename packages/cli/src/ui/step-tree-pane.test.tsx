import type { VisibleTreeRow } from './run-tree-state.js'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { StepTreePane } from './step-tree-pane.js'

const sampleRows: VisibleTreeRow[] = [
  {
    id: 'run',
    depth: 0,
    kind: 'run',
    label: 'demo-harness',
    status: 'running',
    badge: '1/2',
    hasChildren: true,
    isExpanded: true,
    isSelected: false,
    isActive: false,
  },
  {
    id: 'step:triage',
    depth: 1,
    kind: 'step',
    label: 'triage',
    status: 'passed',
    hasChildren: true,
    isExpanded: false,
    isSelected: false,
    isActive: false,
  },
  {
    id: 'step:impl',
    depth: 1,
    kind: 'step',
    label: 'implement',
    status: 'running',
    badge: 'slice 2/3 · attempt 2',
    hasChildren: true,
    isExpanded: true,
    isSelected: true,
    isActive: true,
  },
  {
    id: 'step:wait',
    depth: 1,
    kind: 'step',
    label: 'wait-step',
    status: 'waiting',
    hasChildren: false,
    isExpanded: false,
    isSelected: false,
    isActive: false,
  },
  {
    id: 'step:skip',
    depth: 1,
    kind: 'step',
    label: 'skip-step',
    status: 'skipped',
    hasChildren: false,
    isExpanded: false,
    isSelected: false,
    isActive: false,
  },
  {
    id: 'step:fail',
    depth: 1,
    kind: 'step',
    label: 'fail-step',
    status: 'failed',
    hasChildren: false,
    isExpanded: false,
    isSelected: false,
    isActive: false,
  },
  {
    id: 'step:pend',
    depth: 1,
    kind: 'step',
    label: 'pend-step',
    status: 'pending',
    hasChildren: false,
    isExpanded: false,
    isSelected: false,
    isActive: false,
  },
]

describe('stepTreePane', () => {
  it('renders tree hierarchy, status glyphs, and iteration badges', () => {
    const { lastFrame, unmount } = render(
      <StepTreePane
        rows={sampleRows}
        focused={false}
        followActive={true}
        width={50}
        height={14}
        onMoveSelection={vi.fn()}
        onToggleExpand={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    )
    const frame = lastFrame()!
    expect(frame).toContain('Steps')
    expect(frame).toContain('follow:on')
    expect(frame).toContain('demo-harness [1/2]')
    expect(frame).toContain('triage')
    expect(frame).toContain('implement [slice 2/3 · attempt 2]')
    expect(frame).toContain('wait-step')
    expect(frame).toContain('skip-step')
    expect(frame).toContain('fail-step')
    expect(frame).toContain('pend-step')
    unmount()
  })

  it('dispatches keyboard navigation, expand toggle, and follow toggle when focused', async () => {
    const onMoveSelection = vi.fn()
    const onToggleExpand = vi.fn()
    const onToggleFollow = vi.fn()
    const { stdin, unmount } = render(
      <StepTreePane
        rows={sampleRows}
        focused={true}
        followActive={false}
        width={40}
        height={12}
        onMoveSelection={onMoveSelection}
        onToggleExpand={onToggleExpand}
        onToggleFollow={onToggleFollow}
      />,
    )

    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('j')
    stdin.write('k')
    stdin.write('\r')
    stdin.write('f')

    expect(onMoveSelection).toHaveBeenCalledWith(1)
    expect(onMoveSelection).toHaveBeenCalledWith(-1)
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
    expect(onToggleFollow).toHaveBeenCalledTimes(1)
    unmount()
  })
})
