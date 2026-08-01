import type {
  TerminalLiveInputSender,
  TerminalLiveInputSendOutcome
} from './terminal-live-input-sender'
import {
  queueTerminalLiveHandleSend,
  queueTerminalLiveMirrorSend,
  type TerminalLivePendingFlushState
} from './terminal-live-pending-flush-state'

type MutableCell<T> = { current: T }

type TerminalLiveMirrorPayloadSendOptions = {
  readonly clearPendingLiveInputCommit: () => void
  readonly clearHeldCommitTimer: () => void
  readonly currentLiveInputFieldTextRef: MutableCell<string>
  readonly currentLiveInputGenerationRef: MutableCell<symbol>
  readonly disposedRef: MutableCell<boolean>
  readonly handle: string
  readonly heldLiveInputTextRef: MutableCell<string>
  readonly inputScope: string
  readonly lifecycleEpoch: number
  readonly lifecycleEpochRef: MutableCell<number>
  readonly liveInputGeneration: symbol
  readonly onDeliveryUnknown: () => void
  readonly payload: string
  readonly pendingLiveInputHandleRef: MutableCell<string | null>
  readonly pendingLiveInputFlushRef: TerminalLivePendingFlushState
  readonly rejectedSentText: string
  readonly sendLiveTerminalInputRef: MutableCell<TerminalLiveInputSender>
  readonly sentLiveInputTextRef: MutableCell<string>
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}

export function queueTerminalLiveMirrorPayloadSend({
  clearPendingLiveInputCommit,
  clearHeldCommitTimer,
  currentLiveInputFieldTextRef,
  currentLiveInputGenerationRef,
  disposedRef,
  handle,
  heldLiveInputTextRef,
  inputScope,
  lifecycleEpoch,
  lifecycleEpochRef,
  liveInputGeneration,
  onDeliveryUnknown,
  payload,
  pendingLiveInputHandleRef,
  pendingLiveInputFlushRef,
  rejectedSentText,
  sendLiveTerminalInputRef,
  sentLiveInputTextRef,
  waitForPendingLiveInputFlush
}: TerminalLiveMirrorPayloadSendOptions): Promise<boolean> {
  if (payload.length === 0) {
    return waitForPendingLiveInputFlush()
  }
  const isCurrent = (): boolean =>
    !disposedRef.current &&
    lifecycleEpoch === lifecycleEpochRef.current &&
    liveInputGeneration === currentLiveInputGenerationRef.current
  let outcome: TerminalLiveInputSendOutcome | null = null
  const mirrorSend = queueTerminalLiveMirrorSend(pendingLiveInputFlushRef, () =>
    queueTerminalLiveHandleSend(inputScope, handle, async () => {
      if (!isCurrent()) {
        return false
      }
      try {
        outcome = await sendLiveTerminalInputRef.current(handle, payload)
      } catch {
        outcome = 'unknown'
      }
      return outcome === 'accepted'
    })
  )
  void mirrorSend.then((sent) => {
    if (sent || !outcome || !isCurrent()) {
      return
    }
    lifecycleEpochRef.current += 1
    pendingLiveInputFlushRef.current = null
    clearHeldCommitTimer()
    if (outcome === 'rejected') {
      sentLiveInputTextRef.current = rejectedSentText
      heldLiveInputTextRef.current = currentLiveInputFieldTextRef.current
      pendingLiveInputHandleRef.current =
        currentLiveInputFieldTextRef.current.length > 0 || rejectedSentText.length > 0
          ? handle
          : null
    } else {
      clearPendingLiveInputCommit()
      onDeliveryUnknown()
    }
  })
  return mirrorSend
}
