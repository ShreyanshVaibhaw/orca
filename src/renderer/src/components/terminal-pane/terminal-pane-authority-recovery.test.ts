import { expect, it, vi } from 'vitest'
import { publishTerminalPaneAuthorityTopologyChange } from '@/store/terminal-pane-authority-topology-events'

const storeHarness = vi.hoisted(() => {
  let state: Record<string, unknown>
  const subscribers = new Set<(state: never, previousState: never) => void>()
  const unsubscribeStore = vi.fn()
  const subscribe = vi.fn((listener: (state: never, previousState: never) => void) => {
    subscribers.add(listener)
    return () => {
      subscribers.delete(listener)
      unsubscribeStore()
    }
  })
  return {
    get state() {
      return state
    },
    set state(next: Record<string, unknown>) {
      state = next
    },
    subscribers,
    subscribe,
    unsubscribeStore
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeHarness.state,
    subscribe: storeHarness.subscribe
  }
}))

it('routes 100 unknown panes through one exact authority subscription', async () => {
  const tabs = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `wt-${index}`,
      [{ id: `tab-${index}`, ptyId: `pty-${index}` }]
    ])
  )
  storeHarness.state = {
    tabsByWorktree: tabs,
    ptyIdsByTabId: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`tab-${index}`, []])
    ),
    terminalLayoutsByTabId: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `tab-${index}`,
        { ptyIdsByLeafId: { [`leaf-${index}`]: `pty-${index}` } }
      ])
    ),
    sleepingAgentSessionsByPaneKey: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `tab-${index}:leaf-${index}`,
        { paneKey: `tab-${index}:leaf-${index}` }
      ])
    )
  }
  let authorityChanged: ((payload: { id: string; generation: number }) => void) | undefined
  const unsubscribeAuthority = vi.fn()
  const onLivenessAuthorityChanged = vi.fn(
    (callback: (payload: { id: string; generation: number }) => void) => {
      authorityChanged = callback
      return unsubscribeAuthority
    }
  )
  vi.stubGlobal('window', {
    api: {
      pty: {
        onLivenessAuthorityChanged,
        getPtyLivenessAuthorityGeneration: vi.fn(async () => 0)
      }
    }
  })
  const { captureTerminalPaneAuthorityTopology, waitForTerminalPaneAuthorityChange } =
    await import('./terminal-pane-authority-recovery')
  const recoveries = Array.from({ length: 100 }, () => vi.fn())
  const disposals = recoveries.map((recover, index) => {
    const worktreeId = `wt-${index}`
    const tabId = `tab-${index}`
    const paneKey = `${tabId}:leaf-${index}`
    return waitForTerminalPaneAuthorityChange({
      worktreeId,
      tabId,
      paneKey,
      ptyId: `pty-${index}`,
      initial: captureTerminalPaneAuthorityTopology(worktreeId, tabId, paneKey),
      initialAuthorityGeneration: 0,
      recover
    })
  })

  expect(storeHarness.subscribe).not.toHaveBeenCalled()
  expect(onLivenessAuthorityChanged).toHaveBeenCalledOnce()
  authorityChanged?.({ id: 'unrelated-pty', generation: 1 })
  expect(recoveries.every((recover) => recover.mock.calls.length === 0)).toBe(true)

  authorityChanged?.({ id: 'pty-42', generation: 2 })
  expect(recoveries[42]).toHaveBeenCalledOnce()
  expect(recoveries.filter((recover) => recover.mock.calls.length > 0)).toHaveLength(1)

  const previousState = storeHarness.state
  storeHarness.state = {
    ...previousState,
    ptyIdsByTabId: {
      ...(previousState.ptyIdsByTabId as Record<string, string[]>),
      'tab-unrelated': ['unrelated-pty']
    }
  }
  publishTerminalPaneAuthorityTopologyChange({ tabIds: ['tab-unrelated'] })
  expect(recoveries.filter((recover) => recover.mock.calls.length > 0)).toHaveLength(1)

  disposals.forEach((dispose) => dispose())
  expect(storeHarness.unsubscribeStore).not.toHaveBeenCalled()
  expect(unsubscribeAuthority).toHaveBeenCalledOnce()
})

it('routes paced 100-pane hydration through exact tab indexes', async () => {
  storeHarness.subscribe.mockClear()
  storeHarness.unsubscribeStore.mockClear()
  const tabs = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `wt-${index}`,
      [{ id: `tab-${index}`, ptyId: `pty-${index}` }]
    ])
  )
  storeHarness.state = {
    tabsByWorktree: tabs,
    ptyIdsByTabId: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`tab-${index}`, []])
    ),
    terminalLayoutsByTabId: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `tab-${index}`,
        { ptyIdsByLeafId: { [`leaf-${index}`]: `pty-${index}` } }
      ])
    ),
    sleepingAgentSessionsByPaneKey: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `tab-${index}:leaf-${index}`,
        { paneKey: `tab-${index}:leaf-${index}` }
      ])
    )
  }
  let authorityChanged: ((payload: { id: string; generation: number }) => void) | undefined
  const unsubscribeAuthority = vi.fn()
  vi.stubGlobal('window', {
    api: {
      pty: {
        onLivenessAuthorityChanged: vi.fn(
          (callback: (payload: { id: string; generation: number }) => void) => {
            authorityChanged = callback
            return unsubscribeAuthority
          }
        ),
        getPtyLivenessAuthorityGeneration: vi.fn(async () => 0)
      }
    }
  })
  const { captureTerminalPaneAuthorityTopology, waitForTerminalPaneAuthorityChange } =
    await import('./terminal-pane-authority-recovery')
  const recoveries = Array.from({ length: 100 }, () => vi.fn())
  const disposals = recoveries.map((recover, index) => {
    const worktreeId = `wt-${index}`
    const tabId = `tab-${index}`
    const paneKey = `${tabId}:leaf-${index}`
    return waitForTerminalPaneAuthorityChange({
      worktreeId,
      tabId,
      paneKey,
      ptyId: `pty-${index}`,
      initial: captureTerminalPaneAuthorityTopology(worktreeId, tabId, paneKey),
      initialAuthorityGeneration: 0,
      recover
    })
  })

  let hydratedPtyIds = storeHarness.state.ptyIdsByTabId as Record<string, string[]>
  let mapReads = 0
  for (let index = 0; index < 100; index++) {
    const previousState = storeHarness.state
    hydratedPtyIds = { ...hydratedPtyIds, [`tab-${index}`]: [`pty-${index}`] }
    const ptyIdsByTabId = new Proxy(hydratedPtyIds, {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('tab-')) {
          mapReads += 1
        }
        return Reflect.get(target, property, receiver)
      }
    })
    storeHarness.state = { ...previousState, ptyIdsByTabId }
    publishTerminalPaneAuthorityTopologyChange({ tabIds: [`tab-${index}`] })
    await Promise.resolve()
  }

  expect(recoveries.every((recover) => recover.mock.calls.length === 1)).toBe(true)
  expect(mapReads).toBe(100)
  authorityChanged?.({ id: 'pty-42', generation: 1 })
  expect(recoveries[42]).toHaveBeenCalledOnce()
  disposals.forEach((dispose) => dispose())
  expect(storeHarness.unsubscribeStore).not.toHaveBeenCalled()
  expect(unsubscribeAuthority).toHaveBeenCalledOnce()
})

it('ignores a targeted topology event after the registration is disposed', async () => {
  storeHarness.subscribe.mockClear()
  storeHarness.unsubscribeStore.mockClear()
  storeHarness.state = {
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1', ptyId: 'pty-1' }] },
    ptyIdsByTabId: { 'tab-1': [] },
    terminalLayoutsByTabId: {
      'tab-1': { ptyIdsByLeafId: { 'leaf-1': 'pty-1' } }
    },
    sleepingAgentSessionsByPaneKey: {
      'tab-1:leaf-1': { paneKey: 'tab-1:leaf-1' }
    }
  }
  const unsubscribeAuthority = vi.fn()
  vi.stubGlobal('window', {
    api: {
      pty: {
        onLivenessAuthorityChanged: vi.fn(() => unsubscribeAuthority),
        getPtyLivenessAuthorityGeneration: vi.fn(async () => 0)
      }
    }
  })
  const { captureTerminalPaneAuthorityTopology, waitForTerminalPaneAuthorityChange } =
    await import('./terminal-pane-authority-recovery')
  const recover = vi.fn()
  const dispose = waitForTerminalPaneAuthorityChange({
    worktreeId: 'wt-1',
    tabId: 'tab-1',
    paneKey: 'tab-1:leaf-1',
    ptyId: 'pty-1',
    initial: captureTerminalPaneAuthorityTopology('wt-1', 'tab-1', 'tab-1:leaf-1'),
    initialAuthorityGeneration: 0,
    recover
  })
  const previousState = storeHarness.state
  storeHarness.state = {
    ...previousState,
    ptyIdsByTabId: { 'tab-1': ['pty-1'] }
  }
  publishTerminalPaneAuthorityTopologyChange({ tabIds: ['tab-1'] })
  dispose()
  await Promise.resolve()

  expect(recover).not.toHaveBeenCalled()
  expect(storeHarness.unsubscribeStore).not.toHaveBeenCalled()
  expect(unsubscribeAuthority).toHaveBeenCalledOnce()
})
