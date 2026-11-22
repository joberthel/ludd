import type { RunStateSnapshot } from '@luddjs/core'
import type { BlueprintGuardrail, HarnessBlueprint, RunUiEntry, UiLogPhase, UiLogScope } from './run-ui-bridge.js'

export type TreeNodeStatus = 'pending' | 'running' | 'waiting' | 'passed' | 'skipped' | 'failed'
export type RunOverallStatus = 'running' | 'waiting_for_gate' | 'passed' | 'failed'

export type KeyedRunUiEntry = RunUiEntry & { id: number }

export interface PhaseItemState {
  id: string
  phase: 'beforeStep' | 'run' | 'afterStep'
  guardrailIndex?: number
  name?: string
  status: TreeNodeStatus
  attempt: number
  retries: number
}

export interface SliceState {
  id: string
  stepId: string
  matrixIndex: number
  status: TreeNodeStatus
  attempt: number
  beforeStep: PhaseItemState[]
  runNode: PhaseItemState
  afterStep: PhaseItemState[]
}

export interface StepTreeItem {
  id: string
  nodeId: string
  name?: string
  status: TreeNodeStatus
  hasMatrix: boolean
  matrixIndex?: number
  matrixTotal?: number
  attempt: number
  beforeStepBlueprint: readonly BlueprintGuardrail[]
  afterStepBlueprint: readonly BlueprintGuardrail[]
  slices: SliceState[]
  beforeStep: PhaseItemState[]
  runNode: PhaseItemState
  afterStep: PhaseItemState[]
}

export interface RunTreeState {
  harnessName: string
  runId?: string
  runStatus: RunOverallStatus
  steps: StepTreeItem[]
  entries: KeyedRunUiEntry[]
  activity?: string
  activeNodeId: string
  selectedNodeId: string
  followActive: boolean
  expandedIds: Record<string, boolean>
  manualExpandOverrides: Record<string, boolean>
}

export type RunTreeAction
  = | { type: 'SET_BLUEPRINT', blueprint: HarnessBlueprint }
    | { type: 'HYDRATE_SNAPSHOT', snapshot: RunStateSnapshot }
    | { type: 'PUSH_ENTRY', entry: RunUiEntry }
    | { type: 'UPSERT_ENTRY', streamKey: string, entry: RunUiEntry }
    | { type: 'GUARDRAIL_STARTED', scope: UiLogScope }
    | { type: 'SET_GATE_WAITING', waiting: boolean, scope?: UiLogScope }
    | { type: 'SET_ACTIVITY', activity: string | undefined }
    | { type: 'SELECT_NODE', nodeId: string }
    | { type: 'MOVE_SELECTION', delta: number }
    | { type: 'TOGGLE_EXPAND', nodeId?: string }
    | { type: 'SET_FOLLOW_ACTIVE', follow: boolean }
    | { type: 'FINISH_RUN', status: 'passed' | 'failed' }

export interface VisibleTreeRow {
  id: string
  depth: number
  kind: 'run' | 'step' | 'slice' | 'phase'
  label: string
  status: TreeNodeStatus | RunOverallStatus
  badge?: string
  hasChildren: boolean
  isExpanded: boolean
  isSelected: boolean
  isActive: boolean
}

export function stepNodeId(stepId: string): string {
  return `step:${stepId}`
}

export function sliceNodeId(stepId: string, matrixIndex: number): string {
  return `slice:${stepId}:${matrixIndex}`
}

export function guardrailNodeId(
  stepId: string,
  matrixIndex: number | undefined,
  phase: 'beforeStep' | 'afterStep',
  index: number,
): string {
  return `guardrail:${stepId}:${matrixIndex ?? 'single'}:${phase}:${index}`
}

export function runPhaseNodeId(stepId: string, matrixIndex: number | undefined): string {
  return `run:${stepId}:${matrixIndex ?? 'single'}`
}

function createPhaseGuardrail(
  stepId: string,
  matrixIndex: number | undefined,
  phase: 'beforeStep' | 'afterStep',
  guardrail: BlueprintGuardrail,
): PhaseItemState {
  return {
    id: guardrailNodeId(stepId, matrixIndex, phase, guardrail.index),
    phase,
    guardrailIndex: guardrail.index,
    ...(guardrail.name !== undefined
      ? { name: guardrail.name }
      : {}),
    status: 'pending',
    attempt: 1,
    retries: 0,
  }
}

function createRunPhaseNode(stepId: string, matrixIndex: number | undefined): PhaseItemState {
  return {
    id: runPhaseNodeId(stepId, matrixIndex),
    phase: 'run',
    name: 'run',
    status: 'pending',
    attempt: 1,
    retries: 0,
  }
}

function createSliceState(step: StepTreeItem, matrixIndex: number): SliceState {
  return {
    id: sliceNodeId(step.id, matrixIndex),
    stepId: step.id,
    matrixIndex,
    status: 'pending',
    attempt: 1,
    beforeStep: step.beforeStepBlueprint.map(g => createPhaseGuardrail(step.id, matrixIndex, 'beforeStep', g)),
    runNode: createRunPhaseNode(step.id, matrixIndex),
    afterStep: step.afterStepBlueprint.map(g => createPhaseGuardrail(step.id, matrixIndex, 'afterStep', g)),
  }
}

function createStepTreeItem(
  id: string,
  opts: {
    name?: string
    hasMatrix?: boolean
    beforeStep?: readonly BlueprintGuardrail[]
    afterStep?: readonly BlueprintGuardrail[]
  },
): StepTreeItem {
  const beforeStepBlueprint = opts.beforeStep ?? []
  const afterStepBlueprint = opts.afterStep ?? []
  return {
    id,
    nodeId: stepNodeId(id),
    ...(opts.name !== undefined
      ? { name: opts.name }
      : {}),
    status: 'pending',
    hasMatrix: opts.hasMatrix === true,
    attempt: 1,
    beforeStepBlueprint,
    afterStepBlueprint,
    slices: [],
    beforeStep: beforeStepBlueprint.map(g => createPhaseGuardrail(id, undefined, 'beforeStep', g)),
    runNode: createRunPhaseNode(id, undefined),
    afterStep: afterStepBlueprint.map(g => createPhaseGuardrail(id, undefined, 'afterStep', g)),
  }
}

export function createInitialRunTreeState(harnessName = 'ludd'): RunTreeState {
  return {
    harnessName,
    runStatus: 'running',
    steps: [],
    entries: [],
    activeNodeId: 'run',
    selectedNodeId: 'run',
    followActive: true,
    expandedIds: { run: true },
    manualExpandOverrides: {},
  }
}

function ensureStep(steps: StepTreeItem[], stepId: string, hasMatrix = false): { steps: StepTreeItem[], step: StepTreeItem } {
  const existing = steps.find(s => s.id === stepId)
  if (existing) {
    if (hasMatrix && !existing.hasMatrix) {
      const updated = { ...existing, hasMatrix: true }
      return {
        steps: steps.map(s => (s.id === stepId
          ? updated
          : s)),
        step: updated,
      }
    }
    return { steps, step: existing }
  }
  const created = createStepTreeItem(stepId, { hasMatrix })
  return {
    steps: [...steps, created],
    step: created,
  }
}

function ensureSlice(step: StepTreeItem, matrixIndex: number, matrixTotal?: number): StepTreeItem {
  const nextTotal = matrixTotal ?? step.matrixTotal
  const hasSlice = step.slices.some(s => s.matrixIndex === matrixIndex)
  let slices = step.slices
  if (!hasSlice) {
    slices = [
      ...slices,
      createSliceState(step, matrixIndex),
    ].sort((a, b) => a.matrixIndex - b.matrixIndex)
  }
  return {
    ...step,
    hasMatrix: true,
    matrixIndex,
    ...(nextTotal !== undefined
      ? { matrixTotal: nextTotal }
      : {}),
    slices,
  }
}

function ensureGuardrailInList(
  list: PhaseItemState[],
  stepId: string,
  matrixIndex: number | undefined,
  phase: 'beforeStep' | 'afterStep',
  index: number,
  name?: string,
): PhaseItemState[] {
  const existing = list.find(g => g.guardrailIndex === index)
  if (existing) {
    if (name !== undefined && existing.name !== name) {
      return list.map(g => (g.guardrailIndex === index
        ? { ...g, name }
        : g))
    }
    return list
  }
  const created = createPhaseGuardrail(stepId, matrixIndex, phase, {
    index,
    ...(name !== undefined
      ? { name }
      : {}),
  })
  return [...list, created].sort((a, b) => a.guardrailIndex! - b.guardrailIndex!)
}

function withActiveNode(state: RunTreeState, nextActiveNodeId: string): RunTreeState {
  const expandedIds = { ...state.expandedIds }
  if (nextActiveNodeId.startsWith('slice:')) {
    const [, stepId] = nextActiveNodeId.split(':')
    const sNode = stepNodeId(stepId)
    if (state.manualExpandOverrides[sNode] === undefined) {
      expandedIds[sNode] = true
    }
    if (state.manualExpandOverrides[nextActiveNodeId] === undefined) {
      expandedIds[nextActiveNodeId] = true
    }
  }
  else if (nextActiveNodeId.startsWith('step:')) {
    if (state.manualExpandOverrides[nextActiveNodeId] === undefined) {
      expandedIds[nextActiveNodeId] = true
    }
  }
  else if (nextActiveNodeId.startsWith('guardrail:') || nextActiveNodeId.startsWith('run:')) {
    const parts = nextActiveNodeId.split(':')
    const stepId = parts[1]
    const matrixPart = parts[2]
    const sNode = stepNodeId(stepId)
    if (state.manualExpandOverrides[sNode] === undefined) {
      expandedIds[sNode] = true
    }
    if (matrixPart !== undefined && matrixPart !== 'single') {
      const slNode = sliceNodeId(stepId, Number(matrixPart))
      if (state.manualExpandOverrides[slNode] === undefined) {
        expandedIds[slNode] = true
      }
    }
  }

  return {
    ...state,
    activeNodeId: nextActiveNodeId,
    ...(state.followActive
      ? { selectedNodeId: nextActiveNodeId }
      : {}),
    expandedIds,
  }
}

function updatePhaseTarget(
  step: StepTreeItem,
  matrixIndex: number | undefined,
  updater: (target: { beforeStep: PhaseItemState[], runNode: PhaseItemState, afterStep: PhaseItemState[], attempt: number, status: TreeNodeStatus }) => {
    beforeStep?: PhaseItemState[]
    runNode?: PhaseItemState
    afterStep?: PhaseItemState[]
    attempt?: number
    status?: TreeNodeStatus
  },
): StepTreeItem {
  if (matrixIndex !== undefined) {
    const ensured = ensureSlice(step, matrixIndex)
    const slice = ensured.slices.find(s => s.matrixIndex === matrixIndex)!
    const patch = updater(slice)
    const updatedSlice: SliceState = {
      ...slice,
      ...patch,
    }
    return {
      ...ensured,
      slices: ensured.slices.map(s => (s.matrixIndex === matrixIndex
        ? updatedSlice
        : s)),
    }
  }
  const patch = updater(step)
  return {
    ...step,
    ...patch,
  }
}

function applyScopeProgress(state: RunTreeState, scope: UiLogScope | undefined): RunTreeState {
  if (scope?.stepId === undefined || scope.stepId === '') {
    return state
  }
  const stepId = scope.stepId
  const isMatrix = scope.matrixIndex !== undefined
  const { steps: ensuredSteps } = ensureStep(state.steps, stepId, isMatrix)
  const nextSteps = ensuredSteps.map((step) => {
    if (step.id !== stepId) {
      return step
    }
    let next = step
    if (scope.matrixIndex !== undefined) {
      next = ensureSlice(next, scope.matrixIndex, scope.matrixTotal)
    }
    else if (scope.matrixTotal !== undefined) {
      next = { ...next, matrixTotal: scope.matrixTotal }
    }
    if (scope.attempt !== undefined) {
      next = updatePhaseTarget(next, scope.matrixIndex, target => ({
        attempt: scope.attempt,
        runNode: { ...target.runNode, attempt: scope.attempt!, status: 'running' },
      }))
      next = { ...next, attempt: scope.attempt }
    }
    return next
  })

  let targetActive = state.activeNodeId
  if (scope.phase === 'beforeStep' || scope.phase === 'afterStep') {
    if (scope.guardrailIndex !== undefined) {
      targetActive = guardrailNodeId(stepId, scope.matrixIndex, scope.phase, scope.guardrailIndex)
    }
  }
  else if (scope.phase === 'run') {
    targetActive = runPhaseNodeId(stepId, scope.matrixIndex)
  }
  else if (scope.matrixIndex !== undefined) {
    targetActive = sliceNodeId(stepId, scope.matrixIndex)
  }

  return withActiveNode({ ...state, steps: nextSteps }, targetActive)
}

function handleBlueprint(state: RunTreeState, blueprint: HarnessBlueprint): RunTreeState {
  const steps = blueprint.steps.map((bp) => {
    const existing = state.steps.find(s => s.id === bp.id)
    const created = createStepTreeItem(bp.id, {
      name: bp.name,
      hasMatrix: bp.hasMatrix,
      beforeStep: bp.beforeStep,
      afterStep: bp.afterStep,
    })
    return existing
      ? {
          ...created,
          status: existing.status,
          matrixIndex: existing.matrixIndex,
          matrixTotal: existing.matrixTotal,
          attempt: existing.attempt,
          slices: existing.slices,
        }
      : created
  })
  return {
    ...state,
    harnessName: blueprint.harnessName,
    runId: blueprint.runId ?? state.runId,
    steps,
  }
}

function handleHydrateSnapshot(state: RunTreeState, snapshot: RunStateSnapshot): RunTreeState {
  let steps = [...state.steps]
  for (const [stepId, res] of Object.entries(snapshot.steps)) {
    const ensured = ensureStep(steps, stepId, Array.isArray(res.output))
    steps = ensured.steps.map((s) => {
      if (s.id !== stepId) {
        return s
      }
      const status: TreeNodeStatus = res.status === 'passed'
        ? 'passed'
        : res.status === 'skipped'
          ? 'skipped'
          : 'failed'
      return {
        ...s,
        status,
        runNode: { ...s.runNode, status },
      }
    })
  }

  let activeNodeId = state.activeNodeId
  if (snapshot.activeStepId !== null && snapshot.activeStepId !== '') {
    const stepId = snapshot.activeStepId
    const hasMatrix = snapshot.activeMatrixIndex !== undefined && snapshot.activeMatrixIndex !== null
    const ensured = ensureStep(steps, stepId, hasMatrix)
    steps = ensured.steps.map((s) => {
      if (s.id !== stepId) {
        return s
      }
      let next: StepTreeItem = {
        ...s,
        status: snapshot.status === 'waiting_for_gate'
          ? 'waiting'
          : 'running',
        attempt: snapshot.activeStepAttempt ?? s.attempt,
        ...(snapshot.activeMatrixTotal !== undefined && snapshot.activeMatrixTotal !== null
          ? { matrixTotal: snapshot.activeMatrixTotal }
          : {}),
      }
      if (hasMatrix && snapshot.activeMatrixIndex !== null && snapshot.activeMatrixIndex !== undefined) {
        const idx = snapshot.activeMatrixIndex
        for (let i = 0; i <= idx; i++) {
          next = ensureSlice(next, i, snapshot.activeMatrixTotal ?? undefined)
        }
        next = {
          ...next,
          matrixIndex: idx,
          slices: next.slices.map((sl) => {
            if (sl.matrixIndex < idx) {
              return { ...sl, status: 'passed' }
            }
            return {
              ...sl,
              status: snapshot.status === 'waiting_for_gate'
                ? 'waiting'
                : 'running',
              attempt: snapshot.activeStepAttempt ?? sl.attempt,
            }
          }),
        }
        activeNodeId = sliceNodeId(stepId, idx)
      }
      else {
        activeNodeId = stepNodeId(stepId)
      }
      return next
    })
  }

  const runStatus: RunOverallStatus = snapshot.status === 'waiting_for_gate'
    ? 'waiting_for_gate'
    : snapshot.status === 'passed'
      ? 'passed'
      : snapshot.status === 'failed'
        ? 'failed'
        : 'running'

  return withActiveNode({
    ...state,
    harnessName: snapshot.harnessName || state.harnessName,
    runId: snapshot.runId || state.runId,
    runStatus,
    steps,
  }, activeNodeId)
}

function handleGuardrailEvent(
  state: RunTreeState,
  scope: UiLogScope | undefined,
  status: TreeNodeStatus,
  guardrailName?: string,
): RunTreeState {
  if (scope === undefined || scope.stepId === undefined || scope.stepId === '') {
    return state
  }
  const stepId = scope.stepId
  const phase: 'beforeStep' | 'afterStep' = scope.phase === 'beforeStep'
    ? 'beforeStep'
    : 'afterStep'
  const matrixIndex = scope.matrixIndex
  const gIndex = scope.guardrailIndex ?? 0
  const name = scope.guardrailName ?? guardrailName

  const { steps: ensuredSteps } = ensureStep(state.steps, stepId, matrixIndex !== undefined)
  const nextSteps = ensuredSteps.map((step) => {
    if (step.id !== stepId) {
      return step
    }
    let next = matrixIndex !== undefined
      ? ensureSlice(step, matrixIndex, scope.matrixTotal)
      : step
    next = updatePhaseTarget(next, matrixIndex, (target) => {
      const listKey = phase
      const ensuredList = ensureGuardrailInList(target[listKey], stepId, matrixIndex, phase, gIndex, name)
      const updatedList = ensuredList.map((item) => {
        if (item.guardrailIndex !== gIndex) {
          return item
        }
        return {
          ...item,
          status,
          ...(name !== undefined
            ? { name }
            : {}),
          ...(status === 'failed'
            ? { retries: item.retries + 1 }
            : {}),
        }
      })
      return { [listKey]: updatedList }
    })
    return next
  })

  const gNodeId = guardrailNodeId(stepId, matrixIndex, phase, gIndex)
  return status === 'running'
    ? withActiveNode({ ...state, steps: nextSteps }, gNodeId)
    : { ...state, steps: nextSteps }
}

function handlePushEntry(state: RunTreeState, entry: RunUiEntry): RunTreeState {
  const keyed: KeyedRunUiEntry = { ...entry, id: state.entries.length }
  let nextState: RunTreeState = {
    ...state,
    entries: [...state.entries, keyed],
  }
  const scope = entry.scope

  switch (entry.kind) {
    case 'run.started':
    case 'run.resumed':
      nextState = {
        ...nextState,
        harnessName: entry.harnessName ?? nextState.harnessName,
        runId: entry.runId ?? nextState.runId,
        runStatus: 'running',
      }
      break
    case 'run.passed':
      nextState = {
        ...nextState,
        runStatus: 'passed',
        activity: undefined,
      }
      break
    case 'run.failed':
      nextState = {
        ...nextState,
        runStatus: 'failed',
        activity: undefined,
      }
      break
    case 'step.started': {
      const { steps } = ensureStep(nextState.steps, entry.stepId, scope?.matrixIndex !== undefined)
      nextState = {
        ...nextState,
        steps: steps.map(s => (s.id === entry.stepId
          ? { ...s, status: 'running', attempt: scope?.attempt ?? s.attempt }
          : s)),
      }
      nextState = withActiveNode(nextState, stepNodeId(entry.stepId))
      break
    }
    case 'step.passed':
    case 'step.skipped':
    case 'step.failed': {
      const status: TreeNodeStatus = entry.kind === 'step.passed'
        ? 'passed'
        : entry.kind === 'step.skipped'
          ? 'skipped'
          : 'failed'
      const { steps } = ensureStep(nextState.steps, entry.stepId)
      nextState = {
        ...nextState,
        steps: steps.map((s) => {
          if (s.id !== entry.stepId) {
            return s
          }
          const slices = s.slices.map(sl => (sl.status === 'running' || sl.status === 'waiting'
            ? {
                ...sl,
                status,
                runNode: { ...sl.runNode, status },
              }
            : sl))
          return {
            ...s,
            status,
            slices,
            runNode: !s.hasMatrix
              ? { ...s.runNode, status }
              : s.runNode,
          }
        }),
      }
      break
    }
    case 'step.retry': {
      const { steps } = ensureStep(nextState.steps, entry.stepId, scope?.matrixIndex !== undefined)
      const attempt = entry.attempt ?? scope?.attempt ?? 2
      nextState = {
        ...nextState,
        steps: steps.map((s) => {
          if (s.id !== entry.stepId) {
            return s
          }
          let updated: StepTreeItem = { ...s, attempt, status: 'running' }
          if (scope?.matrixTotal !== undefined) {
            updated = { ...updated, matrixTotal: scope.matrixTotal }
          }
          updated = updatePhaseTarget(updated, scope?.matrixIndex, target => ({
            attempt,
            status: 'running',
            runNode: {
              ...target.runNode,
              attempt,
              retries: target.runNode.retries + 1,
              status: 'running',
            },
          }))
          return updated
        }),
      }
      nextState = withActiveNode(nextState, runPhaseNodeId(entry.stepId, scope?.matrixIndex))
      break
    }
    case 'guardrail.started':
      nextState = handleGuardrailEvent(applyScopeProgress(nextState, scope), scope, 'running', entry.name)
      break
    case 'guardrail.passed':
      nextState = handleGuardrailEvent(nextState, scope, 'passed', entry.name)
      break
    case 'guardrail.skipped':
      nextState = handleGuardrailEvent(nextState, scope, 'skipped', entry.name)
      break
    case 'guardrail.failed':
      nextState = handleGuardrailEvent(nextState, scope, 'failed', entry.name)
      break
    case 'tool.start':
    case 'tool.error':
    case 'agent.thought':
    case 'agent.text':
    case 'agent.output': {
      nextState = applyScopeProgress(nextState, scope)
      if (scope?.stepId !== undefined && scope.stepId !== '' && scope.phase === 'run') {
        nextState = {
          ...nextState,
          steps: nextState.steps.map((s) => {
            if (s.id !== scope.stepId) {
              return s
            }
            return updatePhaseTarget(s, scope.matrixIndex, target => ({
              status: 'running',
              runNode: { ...target.runNode, status: 'running' },
            }))
          }),
        }
      }
      break
    }
    case 'prompt.answered':
      break
  }

  return nextState
}

function handleUpsertEntry(state: RunTreeState, streamKey: string, entry: RunUiEntry): RunTreeState {
  const existingIndex = state.entries.findIndex(e => e.streamKey === streamKey)
  if (existingIndex !== -1) {
    const existing = state.entries[existingIndex]
    const updated: KeyedRunUiEntry = { ...entry, id: existing.id, streamKey }
    const entries = [...state.entries]
    entries[existingIndex] = updated
    return { ...state, entries }
  }
  return handlePushEntry(state, { ...entry, streamKey })
}

function handleGateWaiting(state: RunTreeState, waiting: boolean, scope?: UiLogScope): RunTreeState {
  const runStatus: RunOverallStatus = waiting ? 'waiting_for_gate' : 'running'
  const stepId = scope?.stepId
  if (stepId === undefined || stepId === '') {
    return { ...state, runStatus }
  }
  const { steps } = ensureStep(state.steps, stepId, scope?.matrixIndex !== undefined)
  const nextStatus: TreeNodeStatus = waiting ? 'waiting' : 'running'
  const nextSteps = steps.map((s) => {
    if (s.id !== stepId) {
      return s
    }
    let updated: StepTreeItem = { ...s, status: nextStatus }
    if (scope?.matrixIndex !== undefined) {
      updated = ensureSlice(updated, scope.matrixIndex, scope.matrixTotal)
      updated = {
        ...updated,
        slices: updated.slices.map(sl => (sl.matrixIndex === scope.matrixIndex
          ? { ...sl, status: nextStatus }
          : sl)),
      }
    }
    if ((scope?.phase === 'beforeStep' || scope?.phase === 'afterStep') && scope.guardrailIndex !== undefined) {
      const phase = scope.phase
      updated = updatePhaseTarget(updated, scope.matrixIndex, target => ({
        [phase]: ensureGuardrailInList(target[phase], stepId, scope.matrixIndex, phase, scope.guardrailIndex!, scope.guardrailName)
          .map(g => (g.guardrailIndex === scope.guardrailIndex
            ? { ...g, status: nextStatus }
            : g)),
      }))
    }
    return updated
  })
  return {
    ...state,
    runStatus,
    steps: nextSteps,
  }
}

export function runTreeReducer(state: RunTreeState, action: RunTreeAction): RunTreeState {
  switch (action.type) {
    case 'SET_BLUEPRINT':
      return handleBlueprint(state, action.blueprint)
    case 'HYDRATE_SNAPSHOT':
      return handleHydrateSnapshot(state, action.snapshot)
    case 'PUSH_ENTRY':
      return handlePushEntry(state, action.entry)
    case 'UPSERT_ENTRY':
      return handleUpsertEntry(state, action.streamKey, action.entry)
    case 'GUARDRAIL_STARTED':
      return handleGuardrailEvent(applyScopeProgress(state, action.scope), action.scope, 'running')
    case 'SET_GATE_WAITING':
      return handleGateWaiting(state, action.waiting, action.scope)
    case 'SET_ACTIVITY':
      return { ...state, activity: action.activity }
    case 'SELECT_NODE':
      return {
        ...state,
        selectedNodeId: action.nodeId,
        followActive: false,
      }
    case 'MOVE_SELECTION': {
      const rows = flattenVisibleTree(state)
      const currentIndex = Math.max(0, rows.findIndex(r => r.id === state.selectedNodeId))
      const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + action.delta))
      const target = rows[nextIndex]
      return {
        ...state,
        selectedNodeId: target.id,
        followActive: false,
      }
    }
    case 'TOGGLE_EXPAND': {
      const targetId = action.nodeId ?? state.selectedNodeId
      const current = Boolean(state.expandedIds[targetId])
      const nextValue = !current
      return {
        ...state,
        expandedIds: { ...state.expandedIds, [targetId]: nextValue },
        manualExpandOverrides: { ...state.manualExpandOverrides, [targetId]: nextValue },
      }
    }
    case 'SET_FOLLOW_ACTIVE':
      return {
        ...state,
        followActive: action.follow,
        ...(action.follow
          ? { selectedNodeId: state.activeNodeId }
          : {}),
      }
    case 'FINISH_RUN':
      return {
        ...state,
        activity: undefined,
        ...(state.runStatus === 'running' || state.runStatus === 'waiting_for_gate'
          ? { runStatus: action.status }
          : {}),
      }
  }
}

function pushPhaseRows(
  rows: VisibleTreeRow[],
  state: RunTreeState,
  depth: number,
  beforeStep: PhaseItemState[],
  runNode: PhaseItemState,
  afterStep: PhaseItemState[],
): void {
  for (const g of beforeStep) {
    rows.push({
      id: g.id,
      depth,
      kind: 'phase',
      label: `before: ${g.name ?? `#${g.guardrailIndex! + 1}`}`,
      status: g.status,
      ...(g.retries > 0
        ? { badge: `retries ${g.retries}` }
        : {}),
      hasChildren: false,
      isExpanded: false,
      isSelected: state.selectedNodeId === g.id,
      isActive: state.activeNodeId === g.id,
    })
  }
  rows.push({
    id: runNode.id,
    depth,
    kind: 'phase',
    label: 'run',
    status: runNode.status,
    ...(runNode.attempt > 1
      ? { badge: `attempt ${runNode.attempt}` }
      : {}),
    hasChildren: false,
    isExpanded: false,
    isSelected: state.selectedNodeId === runNode.id,
    isActive: state.activeNodeId === runNode.id,
  })
  for (const g of afterStep) {
    rows.push({
      id: g.id,
      depth,
      kind: 'phase',
      label: `after: ${g.name ?? `#${g.guardrailIndex! + 1}`}`,
      status: g.status,
      ...(g.retries > 0
        ? { badge: `retries ${g.retries}` }
        : {}),
      hasChildren: false,
      isExpanded: false,
      isSelected: state.selectedNodeId === g.id,
      isActive: state.activeNodeId === g.id,
    })
  }
}

export function flattenVisibleTree(state: RunTreeState): VisibleTreeRow[] {
  const completedCount = state.steps.filter(s => s.status === 'passed' || s.status === 'skipped').length
  const runExpanded = state.expandedIds.run !== false
  const rows: VisibleTreeRow[] = [
    {
      id: 'run',
      depth: 0,
      kind: 'run',
      label: state.harnessName,
      status: state.runStatus,
      ...(state.steps.length > 0
        ? { badge: `${completedCount}/${state.steps.length}` }
        : {}),
      hasChildren: state.steps.length > 0,
      isExpanded: runExpanded,
      isSelected: state.selectedNodeId === 'run',
      isActive: state.activeNodeId === 'run',
    },
  ]

  if (!runExpanded) {
    return rows
  }

  for (const step of state.steps) {
    const badges: string[] = []
    if (step.hasMatrix && step.matrixTotal !== undefined && step.matrixIndex !== undefined) {
      badges.push(`slice ${step.matrixIndex + 1}/${step.matrixTotal}`)
    }
    if (step.attempt > 1) {
      badges.push(`attempt ${step.attempt}`)
    }
    const stepExpanded = Boolean(state.expandedIds[step.nodeId])
    const hasChildren = step.hasMatrix
      ? step.slices.length > 0
      : true

    rows.push({
      id: step.nodeId,
      depth: 1,
      kind: 'step',
      label: step.name ?? step.id,
      status: step.status,
      ...(badges.length > 0
        ? {
            badge: badges.join(' · '),
          }
        : {}),
      hasChildren,
      isExpanded: stepExpanded,
      isSelected: state.selectedNodeId === step.nodeId,
      isActive: state.activeNodeId === step.nodeId,
    })

    if (!stepExpanded) {
      continue
    }

    if (step.hasMatrix) {
      for (const slice of step.slices) {
        const sliceExpanded = Boolean(state.expandedIds[slice.id])
        const totalLabel = step.matrixTotal !== undefined
          ? `/${step.matrixTotal}`
          : ''
        rows.push({
          id: slice.id,
          depth: 2,
          kind: 'slice',
          label: `slice ${slice.matrixIndex + 1}${totalLabel}`,
          status: slice.status,
          ...(slice.attempt > 1
            ? { badge: `attempt ${slice.attempt}` }
            : {}),
          hasChildren: true,
          isExpanded: sliceExpanded,
          isSelected: state.selectedNodeId === slice.id,
          isActive: state.activeNodeId === slice.id,
        })
        if (sliceExpanded) {
          pushPhaseRows(rows, state, 3, slice.beforeStep, slice.runNode, slice.afterStep)
        }
      }
    }
    else {
      pushPhaseRows(rows, state, 2, step.beforeStep, step.runNode, step.afterStep)
    }
  }

  return rows
}

export function getLogsForNode(state: RunTreeState, nodeId: string): KeyedRunUiEntry[] {
  if (nodeId === 'run') {
    return state.entries
  }
  if (nodeId.startsWith('step:')) {
    const stepId = nodeId.slice('step:'.length)
    return state.entries.filter(e => e.scope?.stepId === stepId)
  }
  if (nodeId.startsWith('slice:')) {
    const [, stepId, indexRaw] = nodeId.split(':')
    const matrixIndex = Number(indexRaw)
    return state.entries.filter(e => e.scope?.stepId === stepId && e.scope?.matrixIndex === matrixIndex)
  }
  if (nodeId.startsWith('run:')) {
    const [, stepId, matrixPart] = nodeId.split(':')
    const matrixIndex = matrixPart === 'single'
      ? undefined
      : Number(matrixPart)
    return state.entries.filter(e =>
      e.scope?.stepId === stepId
      && (matrixIndex === undefined
        ? e.scope?.matrixIndex === undefined
        : e.scope?.matrixIndex === matrixIndex)
      && e.scope?.phase === 'run',
    )
  }
  if (nodeId.startsWith('guardrail:')) {
    const [, stepId, matrixPart, phaseRaw, indexRaw] = nodeId.split(':')
    const matrixIndex = matrixPart === 'single'
      ? undefined
      : Number(matrixPart)
    const phase = phaseRaw as UiLogPhase
    const guardrailIndex = Number(indexRaw)
    return state.entries.filter(e =>
      e.scope?.stepId === stepId
      && (matrixIndex === undefined
        ? e.scope?.matrixIndex === undefined
        : e.scope?.matrixIndex === matrixIndex)
      && e.scope?.phase === phase
      && e.scope?.guardrailIndex === guardrailIndex,
    )
  }
  return state.entries
}

export function getNodeBreadcrumb(state: RunTreeState, nodeId: string): string {
  if (nodeId === 'run') {
    return state.harnessName
  }
  if (nodeId.startsWith('step:')) {
    const stepId = nodeId.slice('step:'.length)
    const step = state.steps.find(s => s.id === stepId)
    return `${state.harnessName} › ${step?.name ?? stepId}`
  }
  if (nodeId.startsWith('slice:')) {
    const [, stepId, indexRaw] = nodeId.split(':')
    const step = state.steps.find(s => s.id === stepId)
    const idx = Number(indexRaw) + 1
    const total = step?.matrixTotal !== undefined
      ? `/${step.matrixTotal}`
      : ''
    return `${state.harnessName} › ${step?.name ?? stepId} › slice ${idx}${total}`
  }
  if (nodeId.startsWith('run:')) {
    const [, stepId, matrixPart] = nodeId.split(':')
    const step = state.steps.find(s => s.id === stepId)
    const slicePart = matrixPart !== 'single'
      ? ` › slice ${Number(matrixPart) + 1}`
      : ''
    return `${state.harnessName} › ${step?.name ?? stepId}${slicePart} › run`
  }
  if (nodeId.startsWith('guardrail:')) {
    const [, stepId, matrixPart, phase, indexRaw] = nodeId.split(':')
    const step = state.steps.find(s => s.id === stepId)
    const slicePart = matrixPart !== 'single'
      ? ` › slice ${Number(matrixPart) + 1}`
      : ''
    return `${state.harnessName} › ${step?.name ?? stepId}${slicePart} › ${phase} #${Number(indexRaw) + 1}`
  }
  return state.harnessName
}

export function getNodeStatus(state: RunTreeState, nodeId: string): TreeNodeStatus | RunOverallStatus {
  if (nodeId === 'run') {
    return state.runStatus
  }
  if (nodeId.startsWith('step:')) {
    const stepId = nodeId.slice('step:'.length)
    return state.steps.find(s => s.id === stepId)?.status ?? 'pending'
  }
  if (nodeId.startsWith('slice:')) {
    const [, stepId, indexRaw] = nodeId.split(':')
    const matrixIndex = Number(indexRaw)
    const step = state.steps.find(s => s.id === stepId)
    return step?.slices.find(sl => sl.matrixIndex === matrixIndex)?.status ?? 'pending'
  }
  if (nodeId.startsWith('run:')) {
    const [, stepId, matrixPart] = nodeId.split(':')
    const step = state.steps.find(s => s.id === stepId)
    if (!step) {
      return 'pending'
    }
    if (matrixPart !== undefined && matrixPart !== 'single') {
      const slice = step.slices.find(sl => sl.matrixIndex === Number(matrixPart))
      return slice?.runNode.status ?? 'pending'
    }
    return step.runNode.status
  }
  if (nodeId.startsWith('guardrail:')) {
    const [, stepId, matrixPart, phaseRaw, indexRaw] = nodeId.split(':')
    const step = state.steps.find(s => s.id === stepId)
    if (!step) {
      return 'pending'
    }
    const phase = phaseRaw === 'beforeStep'
      ? 'beforeStep'
      : 'afterStep'
    const gIndex = Number(indexRaw)
    const target = matrixPart !== undefined && matrixPart !== 'single'
      ? step.slices.find(sl => sl.matrixIndex === Number(matrixPart))
      : step
    return target?.[phase].find(g => g.guardrailIndex === gIndex)?.status ?? 'pending'
  }
  return state.runStatus
}
