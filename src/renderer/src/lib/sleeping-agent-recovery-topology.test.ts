import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { publishTerminalPaneAuthorityTopologyChange } from '@/store/terminal-pane-authority-topology-events'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  cancelRecoveryTopologyWait,
  waitForRecoveryTopology
} from './sleeping-agent-recovery-topology'

const initialAppStoreState = useAppStore.getState()
const WORKTREE_ID = 'ssh-worktree'
const TAB_ID = 'original-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PTY_ID = 'ssh:ssh-target@@original-pty'

const record: SleepingAgentSessionRecord = {
  paneKey: makePaneKey(TAB_ID, LEAF_ID),
  tabId: TAB_ID,
  worktreeId: WORKTREE_ID,
  agent: 'codex',
  providerSession: { key: 'session_id', id: 'provider-session' },
  prompt: 'continue',
  state: 'working',
  capturedAt: 1,
  updatedAt: 1,
  origin: 'live'
}

function emptyTopology() {
  return {
    tabsByWorktree: { [WORKTREE_ID]: [] },
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
  }
}

function hydratedTopology() {
  return {
    tabsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: TAB_ID,
          ptyId: PTY_ID,
          worktreeId: WORKTREE_ID,
          title: 'codex',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    ptyIdsByTabId: { [TAB_ID]: [] },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: PTY_ID }
      }
    }
  }
}

afterEach(() => {
  cancelRecoveryTopologyWait(WORKTREE_ID)
  useAppStore.setState(initialAppStoreState, true)
})

describe('sleeping agent recovery topology', () => {
  it('does not let a queued hydration consume a later reconnect wait', async () => {
    useAppStore.setState(emptyTopology() as never)
    const staleRecover = () => {}
    const currentRecover = vi.fn()

    waitForRecoveryTopology(WORKTREE_ID, [record], staleRecover)
    useAppStore.setState(hydratedTopology() as never)
    publishTerminalPaneAuthorityTopologyChange({ worktreeIds: [WORKTREE_ID] })
    cancelRecoveryTopologyWait(WORKTREE_ID)
    useAppStore.setState(emptyTopology() as never)
    waitForRecoveryTopology(WORKTREE_ID, [record], currentRecover)

    await Promise.resolve()
    expect(currentRecover).not.toHaveBeenCalled()

    useAppStore.setState(hydratedTopology() as never)
    publishTerminalPaneAuthorityTopologyChange({ worktreeIds: [WORKTREE_ID] })
    await Promise.resolve()

    expect(currentRecover).toHaveBeenCalledOnce()
    expect(currentRecover).toHaveBeenCalledWith([record])
  })

  it('does not enumerate sleeping records for unrelated paced changes', async () => {
    const records: Record<string, SleepingAgentSessionRecord> = {}
    const tabsByWorktree: Record<string, []> = {}
    const worktreeIds: string[] = []
    for (let index = 0; index < 100; index += 1) {
      const worktreeId = `worktree-${index}`
      const tabId = `tab-${index}`
      const leafId = `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
      const candidate = {
        ...record,
        paneKey: makePaneKey(tabId, leafId),
        tabId,
        worktreeId,
        providerSession: { key: 'session_id' as const, id: `session-${index}` }
      }
      records[candidate.paneKey] = candidate
      tabsByWorktree[worktreeId] = []
      worktreeIds.push(worktreeId)
    }
    useAppStore.setState({
      tabsByWorktree,
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: {},
      sleepingAgentSessionsByPaneKey: records
    } as never)
    for (const worktreeId of worktreeIds) {
      const candidate = Object.values(records).find((entry) => entry.worktreeId === worktreeId)
      if (!candidate) {
        throw new Error(`Missing recovery candidate for ${worktreeId}`)
      }
      waitForRecoveryTopology(worktreeId, [candidate], vi.fn())
    }

    let recordEnumerations = 0
    let currentRecords = records
    try {
      for (let update = 0; update < 100; update += 1) {
        const paneKey = `unrelated-${update}:leaf`
        const nextRecords = {
          ...currentRecords,
          [paneKey]: { ...record, paneKey, worktreeId: 'unrelated-worktree' }
        }
        currentRecords = nextRecords
        const observedRecords = new Proxy(nextRecords, {
          ownKeys(target) {
            recordEnumerations += 1
            return Reflect.ownKeys(target)
          }
        })
        useAppStore.setState({ sleepingAgentSessionsByPaneKey: observedRecords } as never)
        publishTerminalPaneAuthorityTopologyChange({ paneKeys: [paneKey] })
        await Promise.resolve()
      }
      expect(recordEnumerations).toBe(0)
    } finally {
      for (const worktreeId of worktreeIds) {
        cancelRecoveryTopologyWait(worktreeId)
      }
    }
  })
})
