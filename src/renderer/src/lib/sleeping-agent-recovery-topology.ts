import { useAppStore } from '@/store'
import {
  onTerminalPaneAuthorityTopologyChange,
  type TerminalPaneAuthorityTopologyChange
} from '@/store/terminal-pane-authority-topology-events'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { recordWaitsForRecoveryTopology } from './sleeping-agent-recovery-topology-state'

type AppStoreState = ReturnType<typeof useAppStore.getState>

type RecoveryTopologyRegistration = {
  record: SleepingAgentSessionRecord
  tabId: string
  wait: RecoveryTopologyWait
}

type RecoveryTopologyWait = {
  worktreeId: string
  registrationsByPaneKey: Map<string, RecoveryTopologyRegistration>
  recover: (records: readonly SleepingAgentSessionRecord[]) => void
  recovering: boolean
  generation: number
}

type QueuedTopologyChange = {
  paneKeys: Set<string>
  tabIds: Set<string>
  worktreeIds: Set<string>
}

const topologyWaitsByWorktree = new Map<string, RecoveryTopologyWait>()
const registrationsByPaneKey = new Map<string, Set<RecoveryTopologyRegistration>>()
const registrationsByTabId = new Map<string, Set<RecoveryTopologyRegistration>>()
let unsubscribeRecoveryTopology: (() => void) | null = null
let recoveryTopologyDispatching = false
let recoveryTopologyWaitGeneration = 0
let queuedTopologyChange: QueuedTopologyChange | null = null
let queuedTopologyWaitGeneration = 0
let topologyDispatchQueued = false

function addIndexedRegistration(
  index: Map<string, Set<RecoveryTopologyRegistration>>,
  key: string,
  registration: RecoveryTopologyRegistration
): void {
  const registrations = index.get(key) ?? new Set()
  registrations.add(registration)
  index.set(key, registrations)
}

function removeIndexedRegistration(
  index: Map<string, Set<RecoveryTopologyRegistration>>,
  key: string,
  registration: RecoveryTopologyRegistration
): void {
  const registrations = index.get(key)
  registrations?.delete(registration)
  if (registrations?.size === 0) {
    index.delete(key)
  }
}

function removeRegistration(registration: RecoveryTopologyRegistration): void {
  registration.wait.registrationsByPaneKey.delete(registration.record.paneKey)
  removeIndexedRegistration(registrationsByPaneKey, registration.record.paneKey, registration)
  removeIndexedRegistration(registrationsByTabId, registration.tabId, registration)
}

function addRegistration(
  wait: RecoveryTopologyWait,
  record: SleepingAgentSessionRecord
): RecoveryTopologyRegistration | null {
  const stable = parsePaneKey(record.paneKey)
  if (!stable) {
    return null
  }
  const existing = wait.registrationsByPaneKey.get(record.paneKey)
  if (existing?.record === record) {
    return existing
  }
  if (existing) {
    removeRegistration(existing)
  }
  const registration = {
    record,
    tabId: record.tabId ?? stable.tabId,
    wait
  }
  wait.registrationsByPaneKey.set(record.paneKey, registration)
  addIndexedRegistration(registrationsByPaneKey, record.paneKey, registration)
  addIndexedRegistration(registrationsByTabId, registration.tabId, registration)
  return registration
}

function stopTopologySubscriptionIfIdle(): void {
  if (topologyWaitsByWorktree.size > 0) {
    return
  }
  unsubscribeRecoveryTopology?.()
  unsubscribeRecoveryTopology = null
}

export function cancelRecoveryTopologyWait(worktreeId: string): void {
  const wait = topologyWaitsByWorktree.get(worktreeId)
  if (!wait) {
    return
  }
  for (const registration of wait.registrationsByPaneKey.values()) {
    removeRegistration(registration)
  }
  topologyWaitsByWorktree.delete(worktreeId)
  stopTopologySubscriptionIfIdle()
}

function addRecordForWait(
  wait: RecoveryTopologyWait,
  record: SleepingAgentSessionRecord,
  recordsByWait: Map<RecoveryTopologyWait, Set<SleepingAgentSessionRecord>>
): void {
  const records = recordsByWait.get(wait) ?? new Set()
  records.add(record)
  recordsByWait.set(wait, records)
}

function reconcileRegistration(
  registration: RecoveryTopologyRegistration,
  state: AppStoreState,
  recordsByWait: Map<RecoveryTopologyWait, Set<SleepingAgentSessionRecord>>,
  maximumWaitGeneration: number
): void {
  if (
    registration.wait.generation > maximumWaitGeneration ||
    registration.wait.registrationsByPaneKey.get(registration.record.paneKey) !== registration
  ) {
    return
  }
  if (state.sleepingAgentSessionsByPaneKey[registration.record.paneKey] !== registration.record) {
    removeRegistration(registration)
    addRecordForWait(registration.wait, registration.record, recordsByWait)
    return
  }
  if (recordWaitsForRecoveryTopology(registration.record, state)) {
    return
  }
  removeRegistration(registration)
  addRecordForWait(registration.wait, registration.record, recordsByWait)
}

function reconcilePaneKey(
  paneKey: string,
  state: AppStoreState,
  recordsByWait: Map<RecoveryTopologyWait, Set<SleepingAgentSessionRecord>>,
  maximumWaitGeneration: number
): void {
  for (const registration of registrationsByPaneKey.get(paneKey) ?? []) {
    reconcileRegistration(registration, state, recordsByWait, maximumWaitGeneration)
  }
  const record = state.sleepingAgentSessionsByPaneKey[paneKey]
  const wait = record ? topologyWaitsByWorktree.get(record.worktreeId) : null
  if (!record || !wait || wait.generation > maximumWaitGeneration) {
    return
  }
  if (recordWaitsForRecoveryTopology(record, state)) {
    addRegistration(wait, record)
    return
  }
  addRecordForWait(wait, record, recordsByWait)
}

function dispatchResolvedRecords(
  recordsByWait: Map<RecoveryTopologyWait, Set<SleepingAgentSessionRecord>>
): void {
  for (const [wait, records] of recordsByWait) {
    if (wait.recovering || records.size === 0) {
      continue
    }
    wait.recovering = true
    try {
      wait.recover([...records])
    } finally {
      wait.recovering = false
    }
  }
  for (const wait of topologyWaitsByWorktree.values()) {
    if (wait.registrationsByPaneKey.size === 0) {
      topologyWaitsByWorktree.delete(wait.worktreeId)
    }
  }
  stopTopologySubscriptionIfIdle()
}

function dispatchRecoveryTopologyChange(
  change: QueuedTopologyChange,
  maximumWaitGeneration: number
): void {
  if (recoveryTopologyDispatching) {
    return
  }
  recoveryTopologyDispatching = true
  try {
    const state = useAppStore.getState()
    const recordsByWait = new Map<RecoveryTopologyWait, Set<SleepingAgentSessionRecord>>()
    for (const paneKey of change.paneKeys) {
      reconcilePaneKey(paneKey, state, recordsByWait, maximumWaitGeneration)
    }
    const candidates = new Set<RecoveryTopologyRegistration>()
    for (const tabId of change.tabIds) {
      for (const registration of registrationsByTabId.get(tabId) ?? []) {
        candidates.add(registration)
      }
    }
    if (change.paneKeys.size === 0 && change.tabIds.size === 0) {
      for (const worktreeId of change.worktreeIds) {
        const wait = topologyWaitsByWorktree.get(worktreeId)
        for (const registration of wait?.registrationsByPaneKey.values() ?? []) {
          candidates.add(registration)
        }
      }
    }
    for (const registration of candidates) {
      reconcileRegistration(registration, state, recordsByWait, maximumWaitGeneration)
    }
    dispatchResolvedRecords(recordsByWait)
  } finally {
    recoveryTopologyDispatching = false
  }
}

function queueRecoveryTopologyChange(change: TerminalPaneAuthorityTopologyChange): void {
  queuedTopologyChange ??= {
    paneKeys: new Set(),
    tabIds: new Set(),
    worktreeIds: new Set()
  }
  for (const paneKey of change.paneKeys ?? []) {
    queuedTopologyChange.paneKeys.add(paneKey)
  }
  for (const tabId of change.tabIds ?? []) {
    queuedTopologyChange.tabIds.add(tabId)
  }
  for (const worktreeId of change.worktreeIds ?? []) {
    queuedTopologyChange.worktreeIds.add(worktreeId)
  }
  queuedTopologyWaitGeneration = recoveryTopologyWaitGeneration
  if (topologyDispatchQueued) {
    return
  }
  topologyDispatchQueued = true
  queueMicrotask(() => {
    topologyDispatchQueued = false
    const queued = queuedTopologyChange
    const waitGeneration = queuedTopologyWaitGeneration
    queuedTopologyChange = null
    if (queued) {
      dispatchRecoveryTopologyChange(queued, waitGeneration)
    }
  })
}

function ensureRecoveryTopologySubscription(): void {
  unsubscribeRecoveryTopology ??= onTerminalPaneAuthorityTopologyChange(queueRecoveryTopologyChange)
}

export function waitForRecoveryTopology(
  worktreeId: string,
  pendingRecords: readonly SleepingAgentSessionRecord[],
  recover: (records: readonly SleepingAgentSessionRecord[]) => void
): void {
  let wait = topologyWaitsByWorktree.get(worktreeId)
  if (!wait) {
    wait = {
      worktreeId,
      registrationsByPaneKey: new Map(),
      recover,
      recovering: false,
      generation: ++recoveryTopologyWaitGeneration
    }
    topologyWaitsByWorktree.set(worktreeId, wait)
  } else {
    wait.recover = recover
    wait.generation = ++recoveryTopologyWaitGeneration
  }
  const pendingByPaneKey = new Map(pendingRecords.map((record) => [record.paneKey, record]))
  for (const registration of wait.registrationsByPaneKey.values()) {
    if (pendingByPaneKey.get(registration.record.paneKey) !== registration.record) {
      removeRegistration(registration)
    }
  }
  for (const record of pendingRecords) {
    addRegistration(wait, record)
  }
  ensureRecoveryTopologySubscription()
}
