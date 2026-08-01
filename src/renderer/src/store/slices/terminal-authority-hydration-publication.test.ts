import { expect, it, vi } from 'vitest'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { WorkspaceSessionState } from '../../../../shared/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { AppState } from '../types'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { onTerminalPaneAuthorityTopologyChange } from '../terminal-pane-authority-topology-events'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn()
}))

it('publishes only known worktree identities after full and scoped hydration', () => {
  const store = createTestStore()
  const previousWorktreeId = 'repo1::/previous'
  const hydratedWorktreeId = 'repo1::/hydrated'
  const previousTab = makeTab({ id: 'tab-previous', worktreeId: previousWorktreeId })
  const hydratedTab = makeTab({ id: 'tab-hydrated', worktreeId: hydratedWorktreeId })
  seedStore(store, {
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: previousWorktreeId, repoId: 'repo1' }),
        makeWorktree({ id: hydratedWorktreeId, repoId: 'repo1' })
      ]
    },
    tabsByWorktree: { [previousWorktreeId]: [previousTab] }
  })
  const changes: string[][] = []
  const unsubscribe = onTerminalPaneAuthorityTopologyChange((change) => {
    changes.push([...(change.worktreeIds ?? [])].sort())
  })
  const session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: { [hydratedWorktreeId]: [hydratedTab] },
    terminalLayoutsByTabId: {}
  }

  try {
    store.getState().hydrateWorkspaceSession(session)
    expect(changes).toEqual([[hydratedWorktreeId, previousWorktreeId].sort()])

    changes.length = 0
    store.getState().hydrateWorkspaceSession(session, {
      replaceWorkspaceKeys: [hydratedWorktreeId]
    })
    expect(changes).toEqual([[hydratedWorktreeId]])
  } finally {
    unsubscribe()
  }
})

it('publishes only sleeping records changed by a checkpoint and skips no-op checkpoints', () => {
  const store = createTestStore()
  const paneKey = 'tab-agent:leaf-agent'
  const worktreeId = 'repo1::/agent'
  const agentEntry: AgentStatusEntry = {
    state: 'working',
    prompt: 'keep working',
    updatedAt: 10,
    stateStartedAt: 10,
    stateHistory: [],
    agentType: 'codex',
    paneKey,
    tabId: 'tab-agent',
    worktreeId,
    providerSession: { key: 'session_id', id: 'session-agent' }
  }
  seedStore(store, {
    tabsByWorktree: {
      [worktreeId]: [makeTab({ id: 'tab-agent', worktreeId })]
    },
    agentStatusByPaneKey: { [paneKey]: agentEntry }
  } as Partial<AppState>)
  const changes: { paneKeys?: readonly string[]; worktreeIds?: readonly string[] }[] = []
  const unsubscribe = onTerminalPaneAuthorityTopologyChange((change) => changes.push(change))

  try {
    store.getState().captureAllSleepingAgentSessions('periodic')
    expect(changes).toEqual([{ paneKeys: [paneKey] }])

    changes.length = 0
    store.getState().captureAllSleepingAgentSessions('periodic')
    expect(changes).toEqual([])
  } finally {
    unsubscribe()
  }
})

it('publishes agent-status topology only after committed changes', () => {
  const store = createTestStore()
  const changes: { paneKeys?: readonly string[]; worktreeIds?: readonly string[] }[] = []
  const unsubscribe = onTerminalPaneAuthorityTopologyChange((change) => changes.push(change))
  const launchPaneKey = 'tab-launch:leaf-launch'
  const recordPaneKey = 'tab-record:leaf-record'
  const statusPaneKey = 'tab-status:leaf-status'
  const providerSession = { key: 'session_id' as const, id: 'session-record' }

  try {
    const launchConfig = { agentArgs: '', agentEnv: {} }
    const launchMetadata = { agentType: 'codex' as const, tabId: 'tab-launch' }
    store.getState().registerAgentLaunchConfig(launchPaneKey, launchConfig, launchMetadata)
    expect(changes.splice(0)).toEqual([{ paneKeys: [launchPaneKey] }])

    store.getState().registerAgentLaunchConfig(launchPaneKey, launchConfig, launchMetadata)
    expect(changes.splice(0)).toEqual([])

    store.getState().clearSleepingAgentSessionsByPaneKey([launchPaneKey])
    expect(changes.splice(0)).toEqual([{ paneKeys: [launchPaneKey] }])
    store.getState().clearSleepingAgentSessionsByPaneKey([launchPaneKey])
    expect(changes.splice(0)).toEqual([])

    store
      .getState()
      .recordAgentProviderSession('tab-missing:leaf-missing', 'codex', providerSession, {
        updatedAt: 10
      })
    expect(changes.splice(0)).toEqual([])

    store
      .getState()
      .recordAgentProviderSession(
        recordPaneKey,
        'codex',
        providerSession,
        { updatedAt: 10 },
        { tabId: 'tab-record', worktreeId: 'worktree-record' }
      )
    expect(changes.splice(0)).toEqual([{ paneKeys: [recordPaneKey] }])

    store
      .getState()
      .recordAgentProviderSession(
        recordPaneKey,
        'codex',
        providerSession,
        { updatedAt: 9 },
        { tabId: 'tab-record', worktreeId: 'worktree-record' }
      )
    expect(changes.splice(0)).toEqual([])

    store.getState().setSleepingAgentAutomaticResumeBlocked(recordPaneKey, true)
    expect(changes.splice(0)).toEqual([{ paneKeys: [recordPaneKey] }])
    store.getState().setSleepingAgentAutomaticResumeBlocked(recordPaneKey, true)
    expect(changes.splice(0)).toEqual([])

    store
      .getState()
      .setAgentStatus(
        statusPaneKey,
        { state: 'working', prompt: 'parent turn', agentType: 'codex' },
        'Codex',
        { updatedAt: 100, stateStartedAt: 100 }
      )
    expect(changes.splice(0)).toEqual([{ paneKeys: [statusPaneKey] }])

    for (let index = 0; index < 100; index += 1) {
      store
        .getState()
        .setAgentStatus(
          statusPaneKey,
          { state: 'working', prompt: 'stale', agentType: 'codex' },
          'Codex',
          { updatedAt: 99, stateStartedAt: 99 }
        )
    }
    expect(changes.splice(0)).toEqual([])

    store
      .getState()
      .setAgentStatus(
        statusPaneKey,
        { state: 'done', prompt: 'nested child', agentType: 'claude' },
        'Claude',
        { updatedAt: 101, stateStartedAt: 101 }
      )
    expect(changes.splice(0)).toEqual([])
    expect(store.getState().agentStatusByPaneKey[statusPaneKey]?.state).toBe('working')
  } finally {
    unsubscribe()
  }
})

it('publishes only worktrees actually purged from a removed runtime host', () => {
  const store = createTestStore()
  const removedWorktreeId = 'repo-runtime::/removed'
  const unrelatedWorktreeIds = Array.from(
    { length: 100 },
    (_, index) => `repo-local::/unrelated-${index}`
  )
  seedStore(store, {
    repos: [
      {
        id: 'repo-runtime',
        path: '/repo-runtime',
        displayName: 'runtime',
        badgeColor: '#000',
        addedAt: 0,
        executionHostId: toRuntimeExecutionHostId('env-removed')
      }
    ],
    worktreesByRepo: {
      'repo-runtime': [
        makeWorktree({
          id: removedWorktreeId,
          repoId: 'repo-runtime',
          hostId: toRuntimeExecutionHostId('env-removed')
        })
      ]
    },
    tabsByWorktree: Object.fromEntries(
      [removedWorktreeId, ...unrelatedWorktreeIds].map((worktreeId) => [
        worktreeId,
        [makeTab({ id: `tab-${worktreeId}`, worktreeId })]
      ])
    )
  })
  const changes: string[][] = []
  const unsubscribe = onTerminalPaneAuthorityTopologyChange((change) => {
    changes.push([...(change.worktreeIds ?? [])])
  })

  try {
    store.getState().purgeStaleRuntimeHostState(['env-removed'])
    expect(changes).toEqual([[removedWorktreeId]])
  } finally {
    unsubscribe()
  }
})
