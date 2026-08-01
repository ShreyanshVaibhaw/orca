import { expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../../../shared/types'
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
