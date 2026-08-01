import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import type {
  TerminalLiveInputBoundarySender,
  TerminalLiveInputSender
} from './terminal-live-input-sender'
import {
  createTerminalLiveBoundaryFieldRecoveryState,
  resetTerminalLiveBoundaryFieldRecovery
} from './terminal-live-boundary-field-recovery'
import {
  buildTerminalLiveMirrorPayload,
  computeTerminalLiveMirrorStep,
  TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS
} from './terminal-live-composition-mirror'
import { waitForTerminalLivePendingFlush } from './terminal-live-pending-flush-state'
import { queueTerminalLiveMirrorPayloadSend } from './terminal-live-mirror-payload-send'
import { useTerminalLiveInputDisconnectReconcile } from './use-terminal-live-input-disconnect-reconcile'
import { useTerminalLiveInputBoundary } from './use-terminal-live-input-boundary'

const ignoreTerminalLiveInputDeliveryUnknown = (): void => undefined

type TerminalLivePendingInputFlushOptions<TTabType extends string> = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly inputStateReady: boolean
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputGeneration: symbol
  readonly liveInputProducerGeneration: symbol
  readonly liveInputScope: string
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly onDeliveryUnknown?: () => void
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

type TerminalLivePendingInputFlush = {
  readonly applyLiveInputMirror: (handle: string, fieldText: string, captureText?: string) => void
  readonly clearPendingLiveInputCommit: () => void
  readonly currentLiveInputFieldTextRef: RefObject<string>
  readonly heldLiveInputTextRef: RefObject<string>
  readonly isLiveInputProducerCurrent: () => boolean
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly reconcileLiveInputAfterDisconnect: () => void
  readonly runLiveInputBoundary: TerminalLiveInputBoundarySender
  readonly sentLiveInputTextRef: RefObject<string>
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}

export function useTerminalLivePendingInputFlush<TTabType extends string>({
  activeHandleRef,
  activeSessionTabTypeRef,
  inputStateReady,
  liveInputRef,
  liveInputGeneration,
  liveInputProducerGeneration,
  liveInputScope,
  liveInputTerminalHandlesRef,
  onDeliveryUnknown = ignoreTerminalLiveInputDeliveryUnknown,
  sendLiveTerminalInputRef,
  setLiveInputCapture
}: TerminalLivePendingInputFlushOptions<TTabType>): TerminalLivePendingInputFlush {
  const heldCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLiveInputFlushRef = useRef<Promise<boolean> | null>(null)
  const lifecycleEpochRef = useRef(0)
  const appliedLiveInputGenerationRef = useRef(liveInputGeneration)
  const currentLiveInputGenerationRef = useRef(liveInputGeneration)
  const currentLiveInputProducerGenerationRef = useRef(liveInputProducerGeneration)
  const disposedRef = useRef(false)
  const currentLiveInputFieldTextRef = useRef('')
  const heldLiveInputTextRef = useRef('')
  const sentLiveInputTextRef = useRef('')
  const pendingLiveInputHandleRef = useRef<string | null>(null)
  const boundaryFieldRecoveryRef = useRef(createTerminalLiveBoundaryFieldRecoveryState())
  const runMirrorStepRef = useRef<
    (handle: string, fieldText: string, commitHeld: boolean) => Promise<boolean>
  >(async () => false)

  const clearHeldCommitTimer = useCallback(() => {
    if (heldCommitTimerRef.current) {
      clearTimeout(heldCommitTimerRef.current)
      heldCommitTimerRef.current = null
    }
  }, [])

  const resetMirrorState = useCallback(() => {
    clearHeldCommitTimer()
    resetTerminalLiveBoundaryFieldRecovery(boundaryFieldRecoveryRef.current)
    heldLiveInputTextRef.current = ''
    sentLiveInputTextRef.current = ''
    currentLiveInputFieldTextRef.current = ''
    pendingLiveInputHandleRef.current = null
  }, [clearHeldCommitTimer])

  const clearPendingLiveInputCommit = useCallback(() => {
    resetMirrorState()
    setLiveInputCapture('')
    liveInputRef.current?.setNativeProps({ text: '' })
  }, [liveInputRef, resetMirrorState, setLiveInputCapture])

  useLayoutEffect(() => {
    currentLiveInputGenerationRef.current = liveInputGeneration
    currentLiveInputProducerGenerationRef.current = liveInputProducerGeneration
    if (appliedLiveInputGenerationRef.current === liveInputGeneration) {
      return
    }
    appliedLiveInputGenerationRef.current = liveInputGeneration
    lifecycleEpochRef.current += 1
    pendingLiveInputFlushRef.current = null
    clearPendingLiveInputCommit()
  }, [clearPendingLiveInputCommit, liveInputGeneration, liveInputProducerGeneration])

  const waitForPendingLiveInputFlush = useCallback(async (): Promise<boolean> => {
    return waitForTerminalLivePendingFlush(pendingLiveInputFlushRef)
  }, [])

  // Why: pre-disconnect sends must not release queued control bytes after recovery.
  const reconcileLiveInputAfterDisconnect = useTerminalLiveInputDisconnectReconcile({
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
  })

  const runMirrorStep = useCallback(
    async (handle: string, fieldText: string, commitHeld: boolean): Promise<boolean> => {
      if (
        !inputStateReady ||
        disposedRef.current ||
        liveInputGeneration !== currentLiveInputGenerationRef.current
      ) {
        return false
      }
      if (
        handle !== activeHandleRef.current ||
        (activeSessionTabTypeRef.current != null &&
          activeSessionTabTypeRef.current !== 'terminal') ||
        !liveInputTerminalHandlesRef.current.has(handle)
      ) {
        // Why: a stale handle must not keep local mirror state alive — the next
        // active terminal would inherit wrong erase counts. A null tab type is
        // "unknown" during tab-list lag, not "left the terminal", so it must not trip.
        resetMirrorState()
        return false
      }

      currentLiveInputFieldTextRef.current = fieldText
      const rejectedFieldEpoch = boundaryFieldRecoveryRef.current.currentFieldEpoch
      const fieldRecoveryGeneration = boundaryFieldRecoveryRef.current.generation
      const rejectedSentText = sentLiveInputTextRef.current
      const step = computeTerminalLiveMirrorStep(rejectedSentText, fieldText, {
        commitHeld
      })
      sentLiveInputTextRef.current = step.nextSentText
      heldLiveInputTextRef.current = step.heldText
      pendingLiveInputHandleRef.current =
        step.heldText.length > 0 || step.nextSentText.length > 0 ? handle : null

      clearHeldCommitTimer()
      // Why: a 'boundary' hold is released by the next keystroke or an explicit
      // flush only. Arming a settle timer for it would race the flick keyboard's
      // modifier key and commit the base kana the user is about to replace.
      if (step.heldText.length > 0 && step.heldCommitPolicy === 'timer') {
        const lifecycleEpoch = lifecycleEpochRef.current
        heldCommitTimerRef.current = setTimeout(() => {
          heldCommitTimerRef.current = null
          if (
            disposedRef.current ||
            lifecycleEpoch !== lifecycleEpochRef.current ||
            liveInputGeneration !== currentLiveInputGenerationRef.current
          ) {
            return
          }
          void runMirrorStepRef.current(handle, currentLiveInputFieldTextRef.current, true)
        }, TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)
      }

      const payload = buildTerminalLiveMirrorPayload(step)
      return queueTerminalLiveMirrorPayloadSend({
        clearPendingLiveInputCommit,
        clearHeldCommitTimer,
        boundaryFieldRecoveryRef,
        currentLiveInputFieldTextRef,
        currentLiveInputGenerationRef,
        disposedRef,
        fieldRecoveryGeneration,
        handle,
        heldLiveInputTextRef,
        inputScope: liveInputScope,
        lifecycleEpoch: lifecycleEpochRef.current,
        lifecycleEpochRef,
        liveInputGeneration,
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
      })
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      clearHeldCommitTimer,
      inputStateReady,
      liveInputGeneration,
      liveInputRef,
      liveInputScope,
      liveInputTerminalHandlesRef,
      onDeliveryUnknown,
      resetMirrorState,
      sendLiveTerminalInputRef,
      setLiveInputCapture,
      waitForPendingLiveInputFlush
    ]
  )
  useLayoutEffect(() => {
    runMirrorStepRef.current = runMirrorStep
  }, [runMirrorStep])

  const applyLiveInputMirror = useCallback(
    (handle: string, fieldText: string, captureText = fieldText): void => {
      boundaryFieldRecoveryRef.current.currentCaptureText = captureText
      void runMirrorStep(handle, fieldText, false)
    },
    [runMirrorStep]
  )

  const runLiveInputBoundary = useTerminalLiveInputBoundary({
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
  })

  useLayoutEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      lifecycleEpochRef.current += 1
      if (heldCommitTimerRef.current) {
        clearTimeout(heldCommitTimerRef.current)
        heldCommitTimerRef.current = null
      }
      heldLiveInputTextRef.current = ''
      resetTerminalLiveBoundaryFieldRecovery(boundaryFieldRecoveryRef.current)
      sentLiveInputTextRef.current = ''
      currentLiveInputFieldTextRef.current = ''
      pendingLiveInputHandleRef.current = null
      pendingLiveInputFlushRef.current = null
    }
  }, [])

  return {
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    currentLiveInputFieldTextRef,
    heldLiveInputTextRef,
    isLiveInputProducerCurrent: () =>
      inputStateReady &&
      !disposedRef.current &&
      liveInputProducerGeneration === currentLiveInputProducerGenerationRef.current,
    pendingLiveInputHandleRef,
    reconcileLiveInputAfterDisconnect,
    runLiveInputBoundary,
    sentLiveInputTextRef,
    waitForPendingLiveInputFlush
  }
}
