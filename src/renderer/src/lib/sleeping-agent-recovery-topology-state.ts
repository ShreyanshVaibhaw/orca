import type { useAppStore } from '@/store'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import {
  getPreservedStablePaneRecoveryTabId,
  recordHasStablePaneIdentity
} from './sleeping-agent-pane-ownership'

type AppStoreState = ReturnType<typeof useAppStore.getState>

export function recordWaitsForRecoveryTopology(
  record: SleepingAgentSessionRecord,
  state: AppStoreState
): boolean {
  return (
    (record.origin === 'live' || record.origin === 'quit' || record.origin === 'worktree-sleep') &&
    recordHasStablePaneIdentity(record) &&
    getPreservedStablePaneRecoveryTabId(record, state) === null
  )
}
