import type { RunStateSnapshot } from '@ludd/core'
import { describe, expect, it } from 'vitest'
import {
  createInitialRunTreeState,
  flattenVisibleTree,
  getLogsForNode,
  getNodeBreadcrumb,
  guardrailNodeId,
  runPhaseNodeId,
  runTreeReducer,
  sliceNodeId,
  stepNodeId,
} from './run-tree-state.js'

describe('runTreeReducer & tree selectors', () => {
  it('initializes pending steps and static guardrails from blueprint', () => {
    let state = createInitialRunTreeState('initial')
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'demo-harness',
        steps: [
          {
            id: 'triage',
            name: 'Triage',
            hasMatrix: false,
            beforeStep: [
              { index: 0, name: 'context' },
            ],
            afterStep: [
              { index: 0, name: 'schema' },
            ],
          },
          {
            id: 'implement',
            hasMatrix: true,
            afterStep: [
              { index: 0, name: 'lint' },
            ],
          },
        ],
      },
    })

    expect(state.harnessName).toBe('demo-harness')
    const rows = flattenVisibleTree(state)
    expect(rows.map(r => [r.id, r.status, r.badge])).toEqual([
      ['run', 'running', '0/2'],
      ['step:triage', 'pending', undefined],
      ['step:implement', 'pending', undefined],
    ])

    // Expand triage to see beforeStep, run, afterStep
    state = runTreeReducer(state, { type: 'TOGGLE_EXPAND', nodeId: 'step:triage' })
    const expandedRows = flattenVisibleTree(state)
    expect(expandedRows.map(r => [r.id, r.depth, r.label])).toEqual([
      ['run', 0, 'demo-harness'],
      ['step:triage', 1, 'Triage'],
      ['guardrail:triage:single:beforeStep:0', 2, 'before: context'],
      ['run:triage:single', 2, 'run'],
      [
        'guardrail:triage:single:afterStep:0',
        2,
        'after: lint'.replace('lint', 'schema'),
      ],
      ['step:implement', 1, 'implement'],
    ])
  })

  it('hydrates prior step results and active matrix slice from RunStateSnapshot', () => {
    let state = createInitialRunTreeState()
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'demo',
        steps: [
          { id: 'triage', hasMatrix: false },
          { id: 'skipped-step', hasMatrix: false },
          { id: 'implement', hasMatrix: true },
        ],
      },
    })

    const snapshot: RunStateSnapshot = {
      schemaVersion: 1,
      runId: 'run-1',
      harnessName: 'demo',
      workflowName: 'demo',
      status: 'waiting_for_gate',
      activeStepId: 'implement',
      activeStepAttempt: 2,
      activeMatrixIndex: 1,
      activeMatrixTotal: 3,
      steps: {
        'triage': { status: 'passed', output: {} },
        'skipped-step': { status: 'skipped', output: undefined },
      },
      updatedAt: new Date().toISOString(),
    }

    state = runTreeReducer(state, { type: 'HYDRATE_SNAPSHOT', snapshot })
    expect(state.runStatus).toBe('waiting_for_gate')
    expect(state.activeNodeId).toBe(sliceNodeId('implement', 1))
    expect(state.selectedNodeId).toBe(sliceNodeId('implement', 1))

    const rows = flattenVisibleTree(state)
    expect(rows.find(r => r.id === stepNodeId('triage'))?.status).toBe('passed')
    expect(rows.find(r => r.id === stepNodeId('skipped-step'))?.status).toBe('skipped')
    const implRow = rows.find(r => r.id === stepNodeId('implement'))
    expect(implRow?.status).toBe('waiting')
    expect(implRow?.badge).toBe('slice 2/3 · attempt 2')
    expect(rows.find(r => r.id === sliceNodeId('implement', 0))?.status).toBe('passed')
    expect(rows.find(r => r.id === sliceNodeId('implement', 1))?.status).toBe('waiting')
  })

  it('tracks matrix progression, retries, guardrails, and gate transitions', () => {
    let state = createInitialRunTreeState('flow')
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'flow',
        steps: [
          {
            id: 'impl',
            hasMatrix: true,
            afterStep: [
              { index: 0, name: 'test' },
            ],
          },
        ],
      },
    })

    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 'impl',
        scope: { stepId: 'impl' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'slice 1 work',
        scope: {
          stepId: 'impl',
          matrixIndex: 0,
          matrixTotal: 2,
          phase: 'run',
          attempt: 1,
        },
      },
    })
    expect(state.activeNodeId).toBe(runPhaseNodeId('impl', 0))

    // Guardrail fails then step retries
    state = runTreeReducer(state, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 'impl',
        matrixIndex: 0,
        matrixTotal: 2,
        phase: 'afterStep',
        guardrailIndex: 0,
        guardrailName: 'test',
      },
    })
    expect(state.activeNodeId).toBe(guardrailNodeId('impl', 0, 'afterStep', 0))

    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.failed',
        name: 'test',
        scope: {
          stepId: 'impl',
          matrixIndex: 0,
          matrixTotal: 2,
          phase: 'afterStep',
          guardrailIndex: 0,
          guardrailName: 'test',
        },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.retry',
        stepId: 'impl',
        attempt: 2,
        scope: {
          stepId: 'impl',
          matrixIndex: 0,
          matrixTotal: 2,
          phase: 'run',
          attempt: 2,
        },
      },
    })

    // Gate waiting & resolved
    state = runTreeReducer(state, {
      type: 'SET_GATE_WAITING',
      waiting: true,
      scope: {
        stepId: 'impl',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    expect(state.runStatus).toBe('waiting_for_gate')

    state = runTreeReducer(state, {
      type: 'SET_GATE_WAITING',
      waiting: false,
      scope: {
        stepId: 'impl',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    expect(state.runStatus).toBe('running')

    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 'impl',
        scope: { stepId: 'impl' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.passed' },
    })
    expect(state.runStatus).toBe('passed')
  })

  it('filters logs accurately for run, step, slice, run-phase, and guardrail nodes', () => {
    let state = createInitialRunTreeState('flow')
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.started', harnessName: 'flow' },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 's1 slice0',
        scope: { stepId: 's1', matrixIndex: 0, phase: 'run' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.passed',
        name: 'lint',
        scope: {
          stepId: 's1',
          matrixIndex: 0,
          phase: 'afterStep',
          guardrailIndex: 0,
        },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 's1 slice1',
        scope: { stepId: 's1', matrixIndex: 1, phase: 'run' },
      },
    })

    expect(getLogsForNode(state, 'run')).toHaveLength(5)
    expect(getLogsForNode(state, stepNodeId('s1'))).toHaveLength(4)
    expect(getLogsForNode(state, sliceNodeId('s1', 0))).toHaveLength(2)
    expect(getLogsForNode(state, runPhaseNodeId('s1', 0)).map(e => e.kind)).toEqual(['agent.text'])
    expect(getLogsForNode(state, guardrailNodeId('s1', 0, 'afterStep', 0)).map(e => e.kind)).toEqual(['guardrail.passed'])
    expect(getNodeBreadcrumb(state, guardrailNodeId('s1', 0, 'afterStep', 0))).toBe('flow › s1 › slice 1 › afterStep #1')
  })

  it('supports manual navigation, disabling followActive, re-enabling followActive, and manual expand overrides', () => {
    let state = createInitialRunTreeState('flow')
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'flow',
        steps: [
          { id: 's1', hasMatrix: false },
          { id: 's2', hasMatrix: false },
        ],
      },
    })

    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    expect(state.followActive).toBe(true)
    expect(state.selectedNodeId).toBe('step:s1')
    expect(state.expandedIds['step:s1']).toBe(true)

    // User manually collapses s1
    state = runTreeReducer(state, { type: 'TOGGLE_EXPAND', nodeId: 'step:s1' })
    expect(state.expandedIds['step:s1']).toBe(false)
    expect(state.manualExpandOverrides['step:s1']).toBe(false)

    // Subsequent s1 activity respects manual collapse
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'hi',
        scope: { stepId: 's1', phase: 'run' },
      },
    })
    expect(state.expandedIds['step:s1']).toBe(false)

    // User moves selection up to 'run', disabling followActive
    state = runTreeReducer(state, { type: 'MOVE_SELECTION', delta: -1 })
    expect(state.selectedNodeId).toBe('run')
    expect(state.followActive).toBe(false)

    // Re-enabling followActive snaps back to activeNodeId
    state = runTreeReducer(state, { type: 'SET_FOLLOW_ACTIVE', follow: true })
    expect(state.followActive).toBe(true)
    expect(state.selectedNodeId).toBe(state.activeNodeId)
  })

  it('covers remaining reducer transitions, breadcrumbs, and non-matrix filters', () => {
    let state = createInitialRunTreeState('flow')
    state = runTreeReducer(state, { type: 'SET_ACTIVITY', activity: 'working...' })
    expect(state.activity).toBe('working...')

    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.started', harnessName: 'flow' },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.resumed', harnessName: 'flow' },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'tool.start',
        toolName: 'bash',
        scope: { stepId: 's1', phase: 'run', attempt: 1 },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'tool.error',
        toolName: 'bash',
        scope: { stepId: 's1', phase: 'run' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.output',
        output: 'done',
        scope: { stepId: 's1', phase: 'run' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.passed',
        name: 'lint',
        scope: { stepId: 's1', phase: 'afterStep', guardrailIndex: 0 },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.skipped',
        name: 'e2e',
        scope: { stepId: 's1', phase: 'afterStep', guardrailIndex: 1 },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.skipped',
        stepId: 's2',
        scope: { stepId: 's2' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.failed',
        stepId: 's1',
        error: 'err',
        scope: { stepId: 's1' },
      },
    })
    state = runTreeReducer(state, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.failed', error: 'err' },
    })
    expect(state.runStatus).toBe('failed')

    // Re-apply blueprint preserves existing step status
    state = runTreeReducer(state, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'flow',
        steps: [
          { id: 's1', hasMatrix: false },
          { id: 's3', hasMatrix: false },
        ],
      },
    })
    expect(state.steps.find(s => s.id === 's1')?.status).toBe('failed')

    // Non-matrix filters and breadcrumbs
    expect(getLogsForNode(state, runPhaseNodeId('s1', undefined)).length).toBeGreaterThanOrEqual(3)
    expect(getLogsForNode(state, guardrailNodeId('s1', undefined, 'afterStep', 0))).toHaveLength(1)
    expect(getLogsForNode(state, 'unknown-node')).toEqual(state.entries)
    expect(getNodeBreadcrumb(state, 'run')).toBe('flow')
    expect(getNodeBreadcrumb(state, stepNodeId('s1'))).toBe('flow › s1')
    expect(getNodeBreadcrumb(state, sliceNodeId('s1', 0))).toBe('flow › s1 › slice 1')
    expect(getNodeBreadcrumb(state, runPhaseNodeId('s1', undefined))).toBe('flow › s1 › run')
    expect(getNodeBreadcrumb(state, 'unknown-node')).toBe('flow')

    // Collapse root hides children
    state = runTreeReducer(state, { type: 'TOGGLE_EXPAND', nodeId: 'run' })
    expect(flattenVisibleTree(state)).toHaveLength(1)
    state = runTreeReducer(state, { type: 'SELECT_NODE', nodeId: 'run' })
    expect(state.followActive).toBe(false)

    // Edge cases: empty scopes on guardrail and gate events
    state = runTreeReducer(state, { type: 'GUARDRAIL_STARTED', scope: {} })
    state = runTreeReducer(state, { type: 'SET_GATE_WAITING', waiting: true })
    expect(state.runStatus).toBe('waiting_for_gate')
    state = runTreeReducer(state, { type: 'SET_GATE_WAITING', waiting: false })
    expect(state.runStatus).toBe('running')

    // Matrix step with beforeStep, guardrail rename, matrixTotal without matrixIndex, slice-only scope
    let mState = createInitialRunTreeState('m')
    mState = runTreeReducer(mState, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'm',
        steps: [
          { id: 'other', hasMatrix: false },
          {
            id: 'mat',
            hasMatrix: true,
            beforeStep: [
              { index: 0, name: 'init' },
            ],
          },
        ],
      },
    })
    mState = runTreeReducer(mState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'slice0',
        scope: { stepId: 'mat', matrixIndex: 0 },
      },
    })
    mState = runTreeReducer(mState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'total',
        scope: { stepId: 'mat', matrixTotal: 3 },
      },
    })
    mState = runTreeReducer(mState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 'mat',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
        guardrailName: 'renamed',
      },
    })
    mState = runTreeReducer(mState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.retry',
        stepId: 'mat',
        attempt: 2,
        scope: { stepId: 'mat', matrixIndex: 0, phase: 'run' },
      },
    })
    mState = runTreeReducer(mState, {
      type: 'SET_GATE_WAITING',
      waiting: true,
      scope: {
        stepId: 'mat',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
      },
    })
    expect(mState.runStatus).toBe('waiting_for_gate')

    // Hydrate non-matrix active step and matrix step with pre-existing future slice
    const hydratedNonMatrix = runTreeReducer(mState, {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r1',
        harnessName: 'm',
        workflowName: 'm',
        status: 'running',
        activeStepId: 'other',
        steps: {},
        updatedAt: new Date().toISOString(),
      },
    })
    expect(hydratedNonMatrix.activeNodeId).toBe('step:other')

    // Additional branch coverage: promote step to matrix, guardrail without name, retries badge, non-matrix guardrail breadcrumb
    let bState = createInitialRunTreeState('b')
    bState = runTreeReducer(bState, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'b',
        steps: [
          {
            id: 's1',
            hasMatrix: false,
            beforeStep: [
              { index: 0 },
            ],
            afterStep: [
              { index: 0 },
            ],
          },
          { id: 's2', hasMatrix: true },
        ],
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    // Promote s1 to matrix via slice-scoped entry
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'x',
        scope: { stepId: 's1', matrixIndex: 0 },
      },
    })
    // Guardrail fail without name on beforeStep & afterStep increments retries badge, dynamic guardrail without name
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.failed',
        scope: {
          stepId: 's1',
          matrixIndex: 0,
          phase: 'beforeStep',
          guardrailIndex: 0,
        },
      },
    })
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'guardrail.failed',
        scope: {
          stepId: 's1',
          matrixIndex: 0,
          phase: 'afterStep',
          guardrailIndex: 0,
        },
      },
    })
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 2,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.retry',
        stepId: 's1',
        scope: { stepId: 's1', matrixIndex: 0, phase: 'run' },
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'prompt.answered', prompt: 'Q?', answer: 'A' },
    })
    // Non-matrix step.passed + step.failed on matrix step with waiting slice
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's2',
        scope: { stepId: 's2' },
      },
    })
    bState = runTreeReducer(bState, {
      type: 'SET_GATE_WAITING',
      waiting: true,
      scope: {
        stepId: 's2',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    // Toggle expand on s1 (already expanded -> collapses) and s2 (hasMatrix with 0 slices)
    bState = runTreeReducer(bState, { type: 'TOGGLE_EXPAND', nodeId: 'step:s1' })
    bState = runTreeReducer(bState, { type: 'TOGGLE_EXPAND', nodeId: 'step:s1' })
    bState = runTreeReducer(bState, { type: 'TOGGLE_EXPAND', nodeId: 'slice:s1:0' })
    bState = runTreeReducer(bState, { type: 'TOGGLE_EXPAND', nodeId: 'slice:s1:0' })
    expect(flattenVisibleTree(bState).some(r => r.badge === 'retries 1')).toBe(true)
    expect(getNodeBreadcrumb(bState, guardrailNodeId('s1', undefined, 'beforeStep', 0))).toBe('b › s1 › beforeStep #1')
    expect(getNodeBreadcrumb(bState, sliceNodeId('s2', 0))).toBe('b › s2 › slice 1')
    // Guardrail without guardrailIndex defaults to 0; run.resumed without harnessName preserves existing
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: { kind: 'run.resumed' },
    })
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: { stepId: 's1', matrixIndex: 0, phase: 'beforeStep' },
    })
    // Two slices in s2 + two guardrails in afterStep to exercise non-matching map branches
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's2',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's2',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 1,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 's2-1',
        scope: { stepId: 's2', matrixIndex: 1, phase: 'run' },
      },
    })
    bState = runTreeReducer(bState, {
      type: 'SET_GATE_WAITING',
      waiting: true,
      scope: {
        stepId: 's2',
        matrixIndex: 0,
        phase: 'afterStep',
        guardrailIndex: 0,
      },
    })
    bState = runTreeReducer(bState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 's2',
        scope: { stepId: 's2' },
      },
    })
    bState = runTreeReducer(bState, { type: 'SET_FOLLOW_ACTIVE', follow: false })
    expect(bState.followActive).toBe(false)
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
        guardrailName: 'same',
      },
    })
    bState = runTreeReducer(bState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        matrixIndex: 0,
        phase: 'beforeStep',
        guardrailIndex: 0,
        guardrailName: 'same',
      },
    })
    expect(getNodeBreadcrumb(bState, runPhaseNodeId('s2', 0))).toBe('b › s2 › slice 1 › run')

    // Named non-matrix step with 2 guardrails: rename second guardrail, pass step, check breadcrumb
    let nState = createInitialRunTreeState('n')
    nState = runTreeReducer(nState, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'n',
        steps: [
          {
            id: 's1',
            name: 'Step One',
            hasMatrix: false,
            beforeStep: [
              { index: 0, name: 'g0' },
              { index: 1, name: 'g1' },
            ],
          },
        ],
      },
    })
    nState = runTreeReducer(nState, {
      type: 'GUARDRAIL_STARTED',
      scope: {
        stepId: 's1',
        phase: 'beforeStep',
        guardrailIndex: 1,
        guardrailName: 'g1-new',
      },
    })
    nState = runTreeReducer(nState, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    expect(getNodeBreadcrumb(nState, runPhaseNodeId('s1', undefined))).toBe('n › Step One › run')

    // Named matrix step: manual slice override, gate waiting on run phase, slice breadcrumb with step.name
    let m2 = createInitialRunTreeState('m2')
    m2 = runTreeReducer(m2, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'm2',
        steps: [
          { id: 's1', name: 'Matrix One', hasMatrix: true },
        ],
      },
    })
    m2 = runTreeReducer(m2, {
      type: 'TOGGLE_EXPAND',
      nodeId: sliceNodeId('s1', 0),
    })
    m2 = runTreeReducer(m2, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'a',
        scope: {
          stepId: 's1',
          matrixIndex: 0,
          matrixTotal: 2,
          phase: 'run',
        },
      },
    })
    m2 = runTreeReducer(m2, {
      type: 'SET_GATE_WAITING',
      waiting: true,
      scope: { stepId: 's1', matrixIndex: 0, phase: 'run' },
    })
    m2 = runTreeReducer(m2, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    expect(getNodeBreadcrumb(m2, sliceNodeId('s1', 0))).toBe('m2 › Matrix One › slice 1/2')

    // Manual override before step.started & slice activation, plus step.passed with an already-passed slice
    let m3 = createInitialRunTreeState('m3')
    m3 = runTreeReducer(m3, {
      type: 'SET_BLUEPRINT',
      blueprint: {
        harnessName: 'm3',
        steps: [
          { id: 's1', hasMatrix: true },
        ],
      },
    })
    m3 = runTreeReducer(m3, {
      type: 'TOGGLE_EXPAND',
      nodeId: stepNodeId('s1'),
    })
    m3 = runTreeReducer(m3, {
      type: 'TOGGLE_EXPAND',
      nodeId: sliceNodeId('s1', 0),
    })
    m3 = runTreeReducer(m3, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.started',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    m3 = runTreeReducer(m3, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'agent.text',
        text: 'x',
        scope: { stepId: 's1', matrixIndex: 0 },
      },
    })
    m3 = runTreeReducer(m3, {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r3',
        harnessName: 'm3',
        workflowName: 'm3',
        status: 'running',
        activeStepId: 's1',
        activeMatrixIndex: 1,
        steps: {},
        updatedAt: new Date().toISOString(),
      },
    })
    m3 = runTreeReducer(m3, {
      type: 'PUSH_ENTRY',
      entry: {
        kind: 'step.passed',
        stepId: 's1',
        scope: { stepId: 's1' },
      },
    })
    expect(m3.steps[0].slices[0].status).toBe('passed')

    // Hydrate with activeStepId: null on fresh state keeps activeNodeId === 'run'
    const freshHydrated = runTreeReducer(createInitialRunTreeState(), {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r4',
        harnessName: 'm4',
        workflowName: 'm4',
        status: 'passed',
        activeStepId: null,
        steps: {},
        updatedAt: new Date().toISOString(),
      },
    })
    expect(freshHydrated.activeNodeId).toBe('run')
    expect(getNodeBreadcrumb(bState, guardrailNodeId('missing', undefined, 'beforeStep', 0))).toBe('b › missing › beforeStep #1')

    // Hydrate with empty harnessName falls back to state.harnessName
    const fallbackHarness = runTreeReducer(bState, {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r1',
        harnessName: '',
        workflowName: 'b',
        status: 'running',
        activeStepId: 's2',
        activeMatrixIndex: 0,
        steps: {},
        updatedAt: new Date().toISOString(),
      },
    })
    expect(fallbackHarness.harnessName).toBe('b')

    // Hydrate passed and failed snapshots
    const passed = runTreeReducer(state, {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r1',
        harnessName: 'flow',
        workflowName: 'flow',
        status: 'passed',
        activeStepId: null,
        steps: {
          s1: { status: 'failed' },
        },
        updatedAt: new Date().toISOString(),
      },
    })
    expect(passed.runStatus).toBe('passed')

    const failed = runTreeReducer(state, {
      type: 'HYDRATE_SNAPSHOT',
      snapshot: {
        schemaVersion: 1,
        runId: 'r1',
        harnessName: 'flow',
        workflowName: 'flow',
        status: 'failed',
        activeStepId: null,
        steps: {},
        updatedAt: new Date().toISOString(),
      },
    })
    expect(failed.runStatus).toBe('failed')
  })
})
