import type { AppState } from '../types'
import type { SshConnectionState, SshTarget } from '../../../../shared/ssh-types'
import { buildRemovedSshTargetTerminalCleanup } from './ssh-target-terminal-cleanup'

export function sshConnectionStatesEqual(
  a: SshConnectionState | undefined,
  b: SshConnectionState
): boolean {
  return (
    a?.targetId === b.targetId &&
    a?.status === b.status &&
    a?.error === b.error &&
    a?.reconnectAttempt === b.reconnectAttempt &&
    a?.providerEpoch === b.providerEpoch &&
    a?.connectionGeneration === b.connectionGeneration &&
    a?.supportsFolderDownload === b.supportsFolderDownload &&
    a?.remotePlatform === b.remotePlatform
  )
}

export function sshTargetLabelsEqual(
  labels: Map<string, string>,
  targets: Pick<SshTarget, 'id' | 'label'>[]
): boolean {
  if (labels.size !== targets.length) {
    return false
  }
  return targets.every((target) => labels.get(target.id) === target.label)
}

export function buildRemovedSshTargetCleanupPatch(
  state: AppState,
  targetId: string
): { patch: Partial<AppState>; tabIds: string[] } | null {
  const terminalCleanup = buildRemovedSshTargetTerminalCleanup(state, targetId)

  const nextDeferredTargets = state.deferredSshReconnectTargets.filter((id) => id !== targetId)
  const nextTransientClearedConnections = {
    ...state.transientClearedAgentStatusConnectionIds
  }
  const removedTransientClearBlock = Object.prototype.hasOwnProperty.call(
    nextTransientClearedConnections,
    targetId
  )
  delete nextTransientClearedConnections[targetId]
  const nextConnectionStates = new Map(state.sshConnectionStates)
  const removedConnectionState = nextConnectionStates.delete(targetId)
  const nextLabels = new Map(state.sshTargetLabels)
  const removedLabel = nextLabels.delete(targetId)
  const nextHydrated = new Set(state.remoteWorkspaceHydratedTargetIds)
  const removedHydrated = nextHydrated.delete(targetId)
  const removedSyncStatus = Object.prototype.hasOwnProperty.call(
    state.remoteWorkspaceSyncStatusByTargetId,
    targetId
  )
  const removedPortForwards = Object.prototype.hasOwnProperty.call(
    state.portForwardsByConnection,
    targetId
  )
  const removedDetectedPorts = Object.prototype.hasOwnProperty.call(
    state.detectedPortsByConnection,
    targetId
  )
  const nextSyncStatus = { ...state.remoteWorkspaceSyncStatusByTargetId }
  delete nextSyncStatus[targetId]
  const nextPortForwards = { ...state.portForwardsByConnection }
  delete nextPortForwards[targetId]
  const nextDetectedPorts = { ...state.detectedPortsByConnection }
  delete nextDetectedPorts[targetId]
  const nextCredentialQueue = state.sshCredentialQueue.filter((req) => req.targetId !== targetId)
  const removedCredentialRequest = nextCredentialQueue.length !== state.sshCredentialQueue.length
  const removedDeferredTarget =
    nextDeferredTargets.length !== state.deferredSshReconnectTargets.length
  const changed =
    removedTransientClearBlock ||
    removedConnectionState ||
    removedLabel ||
    removedHydrated ||
    removedSyncStatus ||
    removedPortForwards ||
    removedDetectedPorts ||
    terminalCleanup.changed ||
    removedCredentialRequest ||
    removedDeferredTarget
  if (!changed) {
    return null
  }

  return {
    tabIds: terminalCleanup.tabIds,
    patch: {
      ...terminalCleanup.patch,
      ...(removedTransientClearBlock
        ? { transientClearedAgentStatusConnectionIds: nextTransientClearedConnections }
        : {}),
      ...(removedConnectionState ? { sshConnectionStates: nextConnectionStates } : {}),
      ...(removedLabel ? { sshTargetLabels: nextLabels } : {}),
      ...(removedHydrated ? { remoteWorkspaceHydratedTargetIds: nextHydrated } : {}),
      ...(removedSyncStatus ? { remoteWorkspaceSyncStatusByTargetId: nextSyncStatus } : {}),
      ...(removedPortForwards ? { portForwardsByConnection: nextPortForwards } : {}),
      ...(removedDetectedPorts ? { detectedPortsByConnection: nextDetectedPorts } : {}),
      ...(removedCredentialRequest ? { sshCredentialQueue: nextCredentialQueue } : {}),
      ...(removedDeferredTarget ? { deferredSshReconnectTargets: nextDeferredTargets } : {})
    }
  }
}
