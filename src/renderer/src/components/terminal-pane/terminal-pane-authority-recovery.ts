import { useAppStore } from '@/store'
import {
  onTerminalPaneAuthorityTopologyChange,
  type TerminalPaneAuthorityTopologyChange
} from '@/store/terminal-pane-authority-topology-events'

type AppStoreState = ReturnType<typeof useAppStore.getState>

export type TerminalPaneAuthorityTopology = {
  tabs: AppStoreState['tabsByWorktree'][string] | undefined
  tab: AppStoreState['tabsByWorktree'][string][number] | undefined
  ptyIds: AppStoreState['ptyIdsByTabId'][string] | undefined
  layout: AppStoreState['terminalLayoutsByTabId'][string] | undefined
  record: AppStoreState['sleepingAgentSessionsByPaneKey'][string] | undefined
}

type AuthorityRecoveryRegistration = {
  worktreeId: string
  tabId: string
  paneKey: string
  ptyId: string
  initial: TerminalPaneAuthorityTopology
  recover: () => void
  active: boolean
}

const registrations = new Set<AuthorityRecoveryRegistration>()
const registrationsByPtyId = new Map<string, Set<AuthorityRecoveryRegistration>>()
const registrationsByTabId = new Map<string, Set<AuthorityRecoveryRegistration>>()
const registrationsByPaneKey = new Map<string, Set<AuthorityRecoveryRegistration>>()
const registrationsByWorktreeId = new Map<string, Set<AuthorityRecoveryRegistration>>()
let unsubscribeTopology: (() => void) | null = null
let unsubscribeAuthority: (() => void) | null = null
let topologySubscriptionEpoch = 0
let topologyDrainQueued = false
const queuedTopologyRegistrations = new Set<AuthorityRecoveryRegistration>()

function addToIndex(
  index: Map<string, Set<AuthorityRecoveryRegistration>>,
  key: string,
  registration: AuthorityRecoveryRegistration
): void {
  const entries = index.get(key) ?? new Set()
  entries.add(registration)
  index.set(key, entries)
}

function removeFromIndex(
  index: Map<string, Set<AuthorityRecoveryRegistration>>,
  key: string,
  registration: AuthorityRecoveryRegistration
): void {
  const entries = index.get(key)
  entries?.delete(registration)
  if (entries?.size === 0) {
    index.delete(key)
  }
}

function stopSubscriptionsIfIdle(): void {
  if (registrations.size > 0) {
    return
  }
  unsubscribeTopology?.()
  unsubscribeAuthority?.()
  unsubscribeTopology = null
  unsubscribeAuthority = null
  queuedTopologyRegistrations.clear()
  topologyDrainQueued = false
  topologySubscriptionEpoch += 1
}

function removeRegistration(registration: AuthorityRecoveryRegistration): void {
  if (!registration.active) {
    return
  }
  registration.active = false
  registrations.delete(registration)
  queuedTopologyRegistrations.delete(registration)
  removeFromIndex(registrationsByPtyId, registration.ptyId, registration)
  removeFromIndex(registrationsByTabId, registration.tabId, registration)
  removeFromIndex(registrationsByPaneKey, registration.paneKey, registration)
  removeFromIndex(registrationsByWorktreeId, registration.worktreeId, registration)
  stopSubscriptionsIfIdle()
}

export function captureTerminalPaneAuthorityTopology(
  worktreeId: string,
  tabId: string,
  paneKey: string,
  state = useAppStore.getState()
): TerminalPaneAuthorityTopology {
  const tabs = state.tabsByWorktree[worktreeId]
  return {
    tabs,
    tab: tabs?.find((candidate) => candidate.id === tabId),
    ptyIds: state.ptyIdsByTabId[tabId],
    layout: state.terminalLayoutsByTabId[tabId],
    record: state.sleepingAgentSessionsByPaneKey[paneKey]
  }
}

function topologyChanged(
  registration: AuthorityRecoveryRegistration,
  state: AppStoreState
): boolean {
  if (
    state.ptyIdsByTabId[registration.tabId] !== registration.initial.ptyIds ||
    state.terminalLayoutsByTabId[registration.tabId] !== registration.initial.layout ||
    state.sleepingAgentSessionsByPaneKey[registration.paneKey] !== registration.initial.record
  ) {
    return true
  }
  const tabs = state.tabsByWorktree[registration.worktreeId]
  return (
    tabs !== registration.initial.tabs &&
    tabs?.find((candidate) => candidate.id === registration.tabId) !== registration.initial.tab
  )
}

function recoverRegistration(registration: AuthorityRecoveryRegistration): void {
  if (!registration.active) {
    return
  }
  removeRegistration(registration)
  registration.recover()
}

function addIndexedCandidates(
  index: Map<string, Set<AuthorityRecoveryRegistration>>,
  keys: readonly string[] | undefined
): void {
  for (const key of keys ?? []) {
    for (const registration of index.get(key) ?? []) {
      queuedTopologyRegistrations.add(registration)
    }
  }
}

function queueTopologyCandidates(change: TerminalPaneAuthorityTopologyChange): void {
  addIndexedCandidates(registrationsByTabId, change.tabIds)
  addIndexedCandidates(registrationsByPaneKey, change.paneKeys)
  addIndexedCandidates(registrationsByWorktreeId, change.worktreeIds)
  if (topologyDrainQueued || queuedTopologyRegistrations.size === 0) {
    return
  }
  topologyDrainQueued = true
  const epoch = topologySubscriptionEpoch
  queueMicrotask(() => {
    if (epoch !== topologySubscriptionEpoch) {
      return
    }
    topologyDrainQueued = false
    const candidates = [...queuedTopologyRegistrations]
    queuedTopologyRegistrations.clear()
    const state = useAppStore.getState()
    for (const registration of candidates) {
      if (topologyChanged(registration, state)) {
        recoverRegistration(registration)
      }
    }
  })
}

function ensureSubscriptions(): void {
  unsubscribeTopology ??= onTerminalPaneAuthorityTopologyChange(queueTopologyCandidates)
  unsubscribeAuthority ??=
    window.api.pty.onLivenessAuthorityChanged?.((payload) => {
      for (const registration of registrationsByPtyId.get(payload.id) ?? []) {
        recoverRegistration(registration)
      }
    }) ?? (() => {})
}

export function waitForTerminalPaneAuthorityChange(args: {
  worktreeId: string
  tabId: string
  paneKey: string
  ptyId: string
  initial: TerminalPaneAuthorityTopology
  initialAuthorityGeneration: number | null
  recover: () => void
}): () => void {
  const registration: AuthorityRecoveryRegistration = {
    worktreeId: args.worktreeId,
    tabId: args.tabId,
    paneKey: args.paneKey,
    ptyId: args.ptyId,
    initial: args.initial,
    recover: args.recover,
    active: true
  }
  registrations.add(registration)
  addToIndex(registrationsByPtyId, args.ptyId, registration)
  addToIndex(registrationsByTabId, args.tabId, registration)
  addToIndex(registrationsByPaneKey, args.paneKey, registration)
  addToIndex(registrationsByWorktreeId, args.worktreeId, registration)
  ensureSubscriptions()

  if (
    args.initialAuthorityGeneration !== null &&
    window.api.pty.getPtyLivenessAuthorityGeneration
  ) {
    void window.api.pty
      .getPtyLivenessAuthorityGeneration(args.ptyId)
      .then((generation) => {
        if (generation !== args.initialAuthorityGeneration) {
          recoverRegistration(registration)
        }
      })
      .catch(() => {})
  }
  if (topologyChanged(registration, useAppStore.getState())) {
    recoverRegistration(registration)
  }
  return () => removeRegistration(registration)
}
