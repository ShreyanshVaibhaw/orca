import { useCallback, type RefObject } from 'react'
import { getTerminalLiveHeldCommitPolicy } from './terminal-live-composition-mirror'

type TerminalLiveInputDisconnectReconcileOptions<TTabType extends string> = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly clearHeldCommitTimer: () => void
  readonly clearPendingLiveInputCommit: () => void
  readonly heldLiveInputTextRef: RefObject<string>
  readonly lifecycleEpochRef: RefObject<number>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly pendingLiveInputFlushRef: RefObject<Promise<boolean> | null>
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly sentLiveInputTextRef: RefObject<string>
}

export function useTerminalLiveInputDisconnectReconcile<TTabType extends string>({
  activeHandleRef,
  activeSessionTabTypeRef,
  clearHeldCommitTimer,
  clearPendingLiveInputCommit,
  heldLiveInputTextRef,
  lifecycleEpochRef,
  liveInputTerminalHandlesRef,
  pendingLiveInputFlushRef,
  pendingLiveInputHandleRef,
  sentLiveInputTextRef
}: TerminalLiveInputDisconnectReconcileOptions<TTabType>): () => void {
  return useCallback(() => {
    const hadPendingFlush = pendingLiveInputFlushRef.current !== null
    lifecycleEpochRef.current += 1
    pendingLiveInputFlushRef.current = null
    const pendingHandle = pendingLiveInputHandleRef.current
    const heldCodePoint = Array.from(heldLiveInputTextRef.current).at(-1)?.codePointAt(0)
    const canPreserveUnsentKana =
      pendingHandle !== null &&
      pendingHandle === activeHandleRef.current &&
      (activeSessionTabTypeRef.current === null ||
        activeSessionTabTypeRef.current === 'terminal') &&
      liveInputTerminalHandlesRef.current.has(pendingHandle) &&
      sentLiveInputTextRef.current.length === 0 &&
      !hadPendingFlush &&
      heldCodePoint !== undefined &&
      getTerminalLiveHeldCommitPolicy(heldCodePoint) === 'boundary'
    if (canPreserveUnsentKana) {
      clearHeldCommitTimer()
      return
    }
    clearPendingLiveInputCommit()
  }, [
    activeHandleRef,
    activeSessionTabTypeRef,
    clearHeldCommitTimer,
    clearPendingLiveInputCommit,
    heldLiveInputTextRef,
    lifecycleEpochRef,
    liveInputTerminalHandlesRef,
    pendingLiveInputFlushRef,
    pendingLiveInputHandleRef,
    sentLiveInputTextRef
  ])
}
