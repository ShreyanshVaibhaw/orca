import type {
  TerminalLiveInputSender,
  TerminalLiveInputSendOutcome
} from './terminal-live-input-sender'
import type { TextInput } from 'react-native'
import {
  recoverTerminalLiveBoundaryFields,
  type TerminalLiveBoundaryFieldRecoveryState
} from './terminal-live-boundary-field-recovery'
import {
  queueTerminalLiveHandleSend,
  queueTerminalLiveMirrorSend,
  type TerminalLivePendingFlushState
} from './terminal-live-pending-flush-state'

type MutableCell<T> = { current: T }

type TerminalLiveMirrorPayloadSendOptions = {
  readonly boundaryFieldRecoveryRef: MutableCell<TerminalLiveBoundaryFieldRecoveryState>
  readonly clearPendingLiveInputCommit: () => void
  readonly clearHeldCommitTimer: () => void
  readonly currentLiveInputFieldTextRef: MutableCell<string>
  readonly currentLiveInputGenerationRef: MutableCell<symbol>
  readonly currentLiveInputProducerGenerationRef: MutableCell<symbol>
  readonly disposedRef: MutableCell<boolean>
  readonly fieldRecoveryGeneration: symbol
  readonly handle: string
  readonly heldLiveInputTextRef: MutableCell<string>
  readonly inputScope: string
  readonly lifecycleEpoch: number
  readonly lifecycleEpochRef: MutableCell<number>
  readonly liveInputGeneration: symbol
  readonly liveInputProducerGeneration: symbol
  readonly liveInputRef: MutableCell<TextInput | null>
  readonly onDeliveryUnknown: () => void
  readonly payload: string
  readonly pendingLiveInputHandleRef: MutableCell<string | null>
  readonly pendingLiveInputFlushRef: TerminalLivePendingFlushState
  readonly rejectedFieldEpoch: number
  readonly rejectedSentText: string
  readonly sendLiveTerminalInputRef: MutableCell<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
  readonly sentLiveInputTextRef: MutableCell<string>
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}

export function queueTerminalLiveMirrorPayloadSend({
  boundaryFieldRecoveryRef,
  clearPendingLiveInputCommit,
  clearHeldCommitTimer,
  currentLiveInputFieldTextRef,
  currentLiveInputGenerationRef,
  currentLiveInputProducerGenerationRef,
  disposedRef,
  fieldRecoveryGeneration,
  handle,
  heldLiveInputTextRef,
  inputScope,
  lifecycleEpoch,
  lifecycleEpochRef,
  liveInputGeneration,
  liveInputProducerGeneration,
  liveInputRef,
  onDeliveryUnknown,
  payload,
  pendingLiveInputHandleRef,
  pendingLiveInputFlushRef,
  rejectedFieldEpoch,
  rejectedSentText,
  sendLiveTerminalInputRef,
  setLiveInputCapture,
  sentLiveInputTextRef,
  waitForPendingLiveInputFlush
}: TerminalLiveMirrorPayloadSendOptions): Promise<boolean> {
  if (payload.length === 0) {
    return waitForPendingLiveInputFlush()
  }
  const isCurrent = (): boolean =>
    !disposedRef.current &&
    lifecycleEpoch === lifecycleEpochRef.current &&
    liveInputGeneration === currentLiveInputGenerationRef.current &&
    liveInputProducerGeneration === currentLiveInputProducerGenerationRef.current &&
    fieldRecoveryGeneration === boundaryFieldRecoveryRef.current.generation
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
      const recovered = recoverTerminalLiveBoundaryFields(
        boundaryFieldRecoveryRef.current,
        rejectedFieldEpoch,
        currentLiveInputFieldTextRef.current
      )
      sentLiveInputTextRef.current = rejectedSentText
      currentLiveInputFieldTextRef.current = recovered.fieldText
      heldLiveInputTextRef.current = recovered.fieldText
      pendingLiveInputHandleRef.current =
        recovered.fieldText.length > 0 || rejectedSentText.length > 0 ? handle : null
      if (recovered.restoredBoundary) {
        setLiveInputCapture(recovered.captureText)
        liveInputRef.current?.setNativeProps({ text: recovered.captureText })
      }
    } else {
      clearPendingLiveInputCommit()
      onDeliveryUnknown()
    }
  })
  return mirrorSend
}
