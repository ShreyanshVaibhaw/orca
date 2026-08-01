import { useCallback, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import {
  recoverTerminalLiveRejectedBoundary,
  releaseTerminalLiveBoundaryField,
  reserveTerminalLiveBoundaryField,
  type TerminalLiveBoundaryFieldRecoveryState
} from './terminal-live-boundary-field-recovery'
import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputBoundarySender,
  TerminalLiveInputSendOutcome
} from './terminal-live-input-sender'
import {
  queueTerminalLiveBoundarySend,
  queueTerminalLiveHandleSend,
  type TerminalLivePendingFlushState
} from './terminal-live-pending-flush-state'

type TerminalLiveInputBoundaryOptions<TTabType extends string> = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly boundaryFieldRecoveryRef: RefObject<TerminalLiveBoundaryFieldRecoveryState>
  readonly clearHeldCommitTimer: () => void
  readonly clearPendingLiveInputCommit: () => void
  readonly currentLiveInputFieldTextRef: RefObject<string>
  readonly currentLiveInputProducerGenerationRef: RefObject<symbol>
  readonly disposedRef: RefObject<boolean>
  readonly heldLiveInputTextRef: RefObject<string>
  readonly inputStateReady: boolean
  readonly lifecycleEpochRef: RefObject<number>
  readonly liveInputProducerGeneration: symbol
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputScope: string
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly pendingLiveInputFlushRef: TerminalLivePendingFlushState
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly runMirrorStep: (
    handle: string,
    fieldText: string,
    commitHeld: boolean
  ) => Promise<boolean>
  readonly sentLiveInputTextRef: RefObject<string>
  readonly setLiveInputCapture: (text: string) => void
}

export function useTerminalLiveInputBoundary<TTabType extends string>({
  activeHandleRef,
  activeSessionTabTypeRef,
  boundaryFieldRecoveryRef,
  clearHeldCommitTimer,
  clearPendingLiveInputCommit,
  currentLiveInputFieldTextRef,
  currentLiveInputProducerGenerationRef,
  disposedRef,
  heldLiveInputTextRef,
  inputStateReady,
  lifecycleEpochRef,
  liveInputProducerGeneration,
  liveInputRef,
  liveInputScope,
  liveInputTerminalHandlesRef,
  pendingLiveInputFlushRef,
  pendingLiveInputHandleRef,
  runMirrorStep,
  sentLiveInputTextRef,
  setLiveInputCapture
}: TerminalLiveInputBoundaryOptions<TTabType>): TerminalLiveInputBoundarySender {
  return useCallback<TerminalLiveInputBoundarySender>(
    (expectedHandle, sendBoundary, recoveryBytes) => {
      if (
        !inputStateReady ||
        disposedRef.current ||
        liveInputProducerGeneration !== currentLiveInputProducerGenerationRef.current
      ) {
        return Promise.resolve(false)
      }
      if (expectedHandle !== activeHandleRef.current) {
        return Promise.resolve(false)
      }
      const consumeRecoveredBoundary = boundaryFieldRecoveryRef.current.consumeNextBoundary
      const lifecycleEpoch = lifecycleEpochRef.current
      let recoveryToken: symbol | null = null
      const invalidateBoundaryDependents = (
        outcome: TerminalLiveInputSendOutcome | false
      ): void => {
        lifecycleEpochRef.current += 1
        pendingLiveInputFlushRef.current = null
        clearHeldCommitTimer()
        if (outcome === 'rejected' && recoveryBytes !== undefined) {
          const recovered = recoverTerminalLiveRejectedBoundary(
            boundaryFieldRecoveryRef.current,
            recoveryToken,
            recoveryBytes,
            currentLiveInputFieldTextRef.current
          )
          sentLiveInputTextRef.current = ''
          currentLiveInputFieldTextRef.current = recovered.fieldText
          heldLiveInputTextRef.current = recovered.fieldText
          pendingLiveInputHandleRef.current = recovered.fieldText.length > 0 ? expectedHandle : null
          setLiveInputCapture(recovered.captureText)
          liveInputRef.current?.setNativeProps({ text: recovered.captureText })
          return
        }
        clearPendingLiveInputCommit()
      }
      const sendCurrentBoundary = (): Promise<boolean> => {
        let sendOutcome: TerminalLiveInputSendOutcome | null = null
        const isBoundaryCurrent: TerminalLiveInputBoundaryCurrent = () =>
          inputStateReady &&
          !disposedRef.current &&
          lifecycleEpoch === lifecycleEpochRef.current &&
          liveInputProducerGeneration === currentLiveInputProducerGenerationRef.current
        isBoundaryCurrent.reportSendOutcome = (outcome) => {
          sendOutcome = outcome
        }
        return queueTerminalLiveHandleSend(liveInputScope, expectedHandle, async () => {
          if (!isBoundaryCurrent()) {
            return false
          }
          if (consumeRecoveredBoundary) {
            return true
          }
          let sent: boolean
          try {
            sent = await sendBoundary(isBoundaryCurrent)
            if (
              !sent &&
              sendOutcome === 'rejected' &&
              recoveryBytes !== undefined &&
              isBoundaryCurrent()
            ) {
              sendOutcome = null
              sent = await sendBoundary(isBoundaryCurrent)
            }
          } catch (error) {
            if (isBoundaryCurrent()) {
              invalidateBoundaryDependents('unknown')
            }
            throw error
          }
          if (!isBoundaryCurrent()) {
            return false
          }
          if (sent) {
            return true
          }
          invalidateBoundaryDependents(sendOutcome ?? false)
          return false
        })
      }
      const handle = pendingLiveInputHandleRef.current
      if (!handle) {
        return queueTerminalLiveBoundarySend(pendingLiveInputFlushRef, sendCurrentBoundary)
      }
      if (handle !== expectedHandle) {
        clearPendingLiveInputCommit()
        return queueTerminalLiveBoundarySend(pendingLiveInputFlushRef, sendCurrentBoundary)
      }
      if (
        handle !== activeHandleRef.current ||
        (activeSessionTabTypeRef.current != null &&
          activeSessionTabTypeRef.current !== 'terminal') ||
        !liveInputTerminalHandlesRef.current.has(handle)
      ) {
        clearPendingLiveInputCommit()
        return queueTerminalLiveBoundarySend(pendingLiveInputFlushRef, async () => false)
      }

      const fieldText = currentLiveInputFieldTextRef.current
      if (heldLiveInputTextRef.current.length > 0 || fieldText !== sentLiveInputTextRef.current) {
        void runMirrorStep(handle, fieldText, true)
      }
      recoveryToken = reserveTerminalLiveBoundaryField(
        boundaryFieldRecoveryRef.current,
        fieldText,
        consumeRecoveredBoundary ? '' : (recoveryBytes ?? ''),
        consumeRecoveredBoundary
      )
      const boundaryPromise = queueTerminalLiveBoundarySend(
        pendingLiveInputFlushRef,
        sendCurrentBoundary
      )
      clearHeldCommitTimer()
      heldLiveInputTextRef.current = ''
      sentLiveInputTextRef.current = ''
      currentLiveInputFieldTextRef.current = ''
      pendingLiveInputHandleRef.current = null
      setLiveInputCapture('')
      liveInputRef.current?.setNativeProps({ text: '' })
      const releaseRecovery = (): void =>
        releaseTerminalLiveBoundaryField(boundaryFieldRecoveryRef.current, recoveryToken)
      void boundaryPromise.then((sent) => {
        releaseRecovery()
        if (sent && consumeRecoveredBoundary) {
          boundaryFieldRecoveryRef.current.consumeNextBoundary = false
        }
      }, releaseRecovery)
      return boundaryPromise
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      boundaryFieldRecoveryRef,
      clearHeldCommitTimer,
      clearPendingLiveInputCommit,
      currentLiveInputFieldTextRef,
      currentLiveInputProducerGenerationRef,
      disposedRef,
      heldLiveInputTextRef,
      inputStateReady,
      lifecycleEpochRef,
      liveInputProducerGeneration,
      liveInputRef,
      liveInputScope,
      liveInputTerminalHandlesRef,
      pendingLiveInputFlushRef,
      pendingLiveInputHandleRef,
      runMirrorStep,
      sentLiveInputTextRef,
      setLiveInputCapture
    ]
  )
}
