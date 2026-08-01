import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { resolveDirectSshTargetScope } from '../../lib/direct-ssh-target-scope'
import type { AppState } from '../types'

type TerminalCleanupResult = {
  changed: boolean
  patch: Partial<AppState>
  tabIds: string[]
}

function collectSshTargetWorktreeTabIds(state: AppState, targetId: string): Set<string> {
  const targetWorktreeIds = resolveDirectSshTargetScope({
    targetId,
    catalogRevision: 0,
    repos: state.repos,
    worktreesByRepo: state.worktreesByRepo,
    detectedWorktreesByRepo: state.detectedWorktreesByRepo,
    restoredRuntimeHostIdByWorkspaceSessionKey: state.restoredRuntimeHostIdByWorkspaceSessionKey
  }).gitWorktreeIds
  const tabIds = new Set<string>()
  for (const worktreeId of targetWorktreeIds) {
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      tabIds.add(tab.id)
    }
  }
  return tabIds
}

function isSshTargetSessionId(sessionId: string, targetId: string): boolean {
  return parseAppSshPtyId(sessionId)?.connectionId === targetId
}

function omitRemovedSshTargetTabSessions(
  sessions: Record<string, string>,
  targetId: string,
  targetTabIds: Set<string>
): { next: Record<string, string>; removed: boolean; affectedTabIds: string[] } {
  const next: Record<string, string> = {}
  const affectedTabIds: string[] = []
  let removed = false
  for (const [tabId, sessionId] of Object.entries(sessions)) {
    const ownsTarget = isSshTargetSessionId(sessionId, targetId)
    if (targetTabIds.has(tabId) || ownsTarget) {
      if (ownsTarget) {
        affectedTabIds.push(tabId)
      }
      removed = true
      continue
    }
    next[tabId] = sessionId
  }
  return { next, removed, affectedTabIds }
}

function omitRemovedSshTargetRecovery<T extends { authority: { targetId: string } }>(
  entries: Record<string, T>,
  targetId: string,
  targetTabIds: ReadonlySet<string>
): { next: Record<string, T>; removed: boolean; affectedTabIds: string[] } {
  const next: Record<string, T> = {}
  const affectedTabIds: string[] = []
  let removed = false
  for (const [tabId, entry] of Object.entries(entries)) {
    if (targetTabIds.has(tabId) || entry.authority.targetId === targetId) {
      if (entry.authority.targetId === targetId) {
        affectedTabIds.push(tabId)
      }
      removed = true
      continue
    }
    next[tabId] = entry
  }
  return { next, removed, affectedTabIds }
}

function clearSshTargetTabPtyState(
  state: AppState,
  targetId: string,
  targetTabIds: Set<string>
): Pick<
  AppState,
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'lastKnownRelayPtyIdByTabId'
  | 'pendingCodexPaneRestartIds'
  | 'codexRestartNoticeByPtyId'
> & { changed: boolean; affectedTabIds: string[] } {
  let nextTabsByWorktree = state.tabsByWorktree
  const nextPtyIdsByTabId = { ...state.ptyIdsByTabId }
  const nextLastKnownRelayPtyIdByTabId = { ...state.lastKnownRelayPtyIdByTabId }
  const nextPendingCodexPaneRestartIds = { ...state.pendingCodexPaneRestartIds }
  const nextCodexRestartNoticeByPtyId = { ...state.codexRestartNoticeByPtyId }
  const affectedTabIds: string[] = []
  let changed = false

  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    let nextTabs = tabs
    for (const [index, tab] of tabs.entries()) {
      const lastKnownPtyId = state.lastKnownRelayPtyIdByTabId[tab.id]
      const ptyIds = [
        ...new Set([
          ...(state.ptyIdsByTabId[tab.id] ?? []),
          ...(tab.ptyId ? [tab.ptyId] : []),
          ...(lastKnownPtyId ? [lastKnownPtyId] : [])
        ])
      ]
      const shouldClearTab =
        targetTabIds.has(tab.id) || ptyIds.some((ptyId) => isSshTargetSessionId(ptyId, targetId))
      if (!shouldClearTab) {
        continue
      }
      affectedTabIds.push(tab.id)
      if (!tab.ptyId && ptyIds.length === 0 && nextLastKnownRelayPtyIdByTabId[tab.id] == null) {
        continue
      }
      changed = true
      if (nextTabs === tabs) {
        nextTabs = [...tabs]
      }
      const { pendingActivationSpawn: _pendingActivationSpawn, ...tabWithoutActivationSpawn } = tab
      void _pendingActivationSpawn
      nextTabs[index] = { ...tabWithoutActivationSpawn, ptyId: null }
      nextPtyIdsByTabId[tab.id] = []
      delete nextLastKnownRelayPtyIdByTabId[tab.id]
      for (const ptyId of ptyIds) {
        delete nextPendingCodexPaneRestartIds[ptyId]
        delete nextCodexRestartNoticeByPtyId[ptyId]
      }
    }
    if (nextTabs !== tabs) {
      nextTabsByWorktree = { ...nextTabsByWorktree, [worktreeId]: nextTabs }
    }
  }

  return {
    changed,
    affectedTabIds,
    tabsByWorktree: nextTabsByWorktree,
    ptyIdsByTabId: nextPtyIdsByTabId,
    lastKnownRelayPtyIdByTabId: nextLastKnownRelayPtyIdByTabId,
    pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds,
    codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId
  }
}

export function buildRemovedSshTargetTerminalCleanup(
  state: AppState,
  targetId: string
): TerminalCleanupResult {
  const targetTabIds = collectSshTargetWorktreeTabIds(state, targetId)
  const cleanedTabMaps: Record<string, unknown>[] = []
  const lateRemovedTabMaps = new Set<Record<string, unknown>>()
  const markAffectedTabIds = (tabIds: readonly string[]): void => {
    for (const tabId of tabIds) {
      targetTabIds.add(tabId)
      for (const entries of cleanedTabMaps) {
        if (Object.prototype.hasOwnProperty.call(entries, tabId)) {
          delete entries[tabId]
          lateRemovedTabMaps.add(entries)
        }
      }
    }
  }
  const deferredSessions = omitRemovedSshTargetTabSessions(
    state.deferredSshSessionIdsByTabId,
    targetId,
    targetTabIds
  )
  markAffectedTabIds(deferredSessions.affectedTabIds)
  const nextDeferredSessions = deferredSessions.next
  cleanedTabMaps.push(nextDeferredSessions)
  const pendingReconnect = omitRemovedSshTargetTabSessions(
    state.pendingReconnectPtyIdByTabId,
    targetId,
    targetTabIds
  )
  markAffectedTabIds(pendingReconnect.affectedTabIds)
  const nextPendingReconnect = pendingReconnect.next
  cleanedTabMaps.push(nextPendingReconnect)
  const paneRetries = omitRemovedSshTargetRecovery(
    state.directSshPaneRetryByTabId,
    targetId,
    targetTabIds
  )
  markAffectedTabIds(paneRetries.affectedTabIds)
  const nextPaneRetries = paneRetries.next
  cleanedTabMaps.push(nextPaneRetries)
  const liveBindings = omitRemovedSshTargetRecovery(
    state.directSshLivePtyBindingByTabId,
    targetId,
    targetTabIds
  )
  markAffectedTabIds(liveBindings.affectedTabIds)
  const nextLiveBindings = liveBindings.next
  cleanedTabMaps.push(nextLiveBindings)
  const retryHistory = omitRemovedSshTargetRecovery(
    state.directSshPaneRetryHistoryByTabId,
    targetId,
    targetTabIds
  )
  markAffectedTabIds(retryHistory.affectedTabIds)
  const nextRetryHistory = retryHistory.next
  cleanedTabMaps.push(nextRetryHistory)
  const tabPtyState = clearSshTargetTabPtyState(state, targetId, targetTabIds)
  markAffectedTabIds(tabPtyState.affectedTabIds)

  const removedDeferredSession =
    deferredSessions.removed || lateRemovedTabMaps.has(nextDeferredSessions)
  const removedPendingReconnect =
    pendingReconnect.removed || lateRemovedTabMaps.has(nextPendingReconnect)
  const removedPaneRetries = paneRetries.removed || lateRemovedTabMaps.has(nextPaneRetries)
  const removedLiveBindings = liveBindings.removed || lateRemovedTabMaps.has(nextLiveBindings)
  const removedRetryHistory = retryHistory.removed || lateRemovedTabMaps.has(nextRetryHistory)

  return {
    changed:
      tabPtyState.changed ||
      removedDeferredSession ||
      removedPendingReconnect ||
      removedPaneRetries ||
      removedLiveBindings ||
      removedRetryHistory,
    tabIds: [...targetTabIds],
    patch: {
      ...(tabPtyState.changed
        ? {
            tabsByWorktree: tabPtyState.tabsByWorktree,
            ptyIdsByTabId: tabPtyState.ptyIdsByTabId,
            lastKnownRelayPtyIdByTabId: tabPtyState.lastKnownRelayPtyIdByTabId,
            pendingCodexPaneRestartIds: tabPtyState.pendingCodexPaneRestartIds,
            codexRestartNoticeByPtyId: tabPtyState.codexRestartNoticeByPtyId
          }
        : {}),
      ...(removedDeferredSession ? { deferredSshSessionIdsByTabId: nextDeferredSessions } : {}),
      ...(removedPendingReconnect ? { pendingReconnectPtyIdByTabId: nextPendingReconnect } : {}),
      ...(removedPaneRetries ? { directSshPaneRetryByTabId: nextPaneRetries } : {}),
      ...(removedLiveBindings ? { directSshLivePtyBindingByTabId: nextLiveBindings } : {}),
      ...(removedRetryHistory ? { directSshPaneRetryHistoryByTabId: nextRetryHistory } : {})
    }
  }
}
