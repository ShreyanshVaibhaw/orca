import { useCallback, useEffect, useMemo, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import {
  sendTerminalLiveBoundaryBytes,
  type TerminalLiveBoundaryByteSender
} from './terminal-live-boundary-byte-send'
import { getTerminalLiveSpecialKeyDecision } from './terminal-live-text-commit'
import type {
  TerminalLiveInputBoundarySender,
  TerminalLiveInputSender
} from './terminal-live-input-sender'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'
import { useTerminalLivePendingInputFlush } from './use-terminal-live-pending-input-flush'
import {
  useTerminalLiveAccessoryInputCommit,
  type TerminalLiveAccessoryInputCommit
} from './use-terminal-live-accessory-input-commit'

type TerminalLiveInputKeyPressEvent = {
  readonly nativeEvent: {
    readonly key: string
  }
}

type TerminalLiveInputCommitOptions<TTabType extends string> = {
  readonly activeHandle: string | null
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabType: TTabType | null | undefined
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly connected: boolean
  readonly inputStateReady: boolean
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputScope: string
  readonly liveInputTerminalHandles: ReadonlySet<string>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly onDeliveryUnknown?: () => void
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

type TerminalLiveInputCommitHandlers = {
  readonly clearPendingLiveInputCommit: () => void
  readonly handleLiveInputAccessoryBytes: TerminalLiveAccessoryInputCommit
  readonly handleLiveInputChange: (text: string) => void
  readonly handleLiveInputKeyPress: (event: TerminalLiveInputKeyPressEvent) => void
  readonly handleLiveInputSubmit: () => void
  readonly liveInputProducerGeneration: symbol
  readonly sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender
}

export function useTerminalLiveInputCommit<TTabType extends string>({
  activeHandle,
  activeHandleRef,
  activeSessionTabType,
  activeSessionTabTypeRef,
  connected,
  inputStateReady,
  liveInputRef,
  liveInputScope,
  liveInputTerminalHandles,
  liveInputTerminalHandlesRef,
  onDeliveryUnknown,
  sendLiveTerminalInputRef,
  setLiveInputCapture
}: TerminalLiveInputCommitOptions<TTabType>): TerminalLiveInputCommitHandlers {
  const liveInputProducerOwner =
    inputStateReady && (activeSessionTabType == null || activeSessionTabType === 'terminal')
      ? activeHandle
      : null
  const liveInputOwner =
    liveInputProducerOwner && liveInputTerminalHandles.has(liveInputProducerOwner)
      ? liveInputProducerOwner
      : null
  // Buffered producers share the boundary queue, so terminal changes must detach it even with live input off.
  const liveInputGeneration = useMemo(
    () => Symbol('terminal-live-input-generation'),
    [liveInputOwner, liveInputProducerOwner, liveInputScope]
  )
  const liveInputProducerGeneration = useMemo(
    () => Symbol('terminal-live-input-producer-generation'),
    [connected, liveInputGeneration]
  )
  const {
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    currentLiveInputFieldTextRef,
    heldLiveInputTextRef,
    isLiveInputProducerCurrent,
    pendingLiveInputHandleRef,
    reconcileLiveInputAfterDisconnect,
    runLiveInputBoundary,
    sentLiveInputTextRef,
    waitForPendingLiveInputFlush
  } = useTerminalLivePendingInputFlush({
    activeHandleRef,
    activeSessionTabTypeRef,
    inputStateReady,
    liveInputRef,
    liveInputGeneration,
    liveInputProducerGeneration,
    liveInputScope,
    liveInputTerminalHandlesRef,
    onDeliveryUnknown,
    sendLiveTerminalInputRef,
    setLiveInputCapture
  })

  const sendLiveInputBoundaryBytes = useCallback<TerminalLiveBoundaryByteSender>(
    (handle, bytes, isBoundaryCurrent) =>
      sendTerminalLiveBoundaryBytes({
        bytes,
        handle,
        isBoundaryCurrent,
        onDeliveryUnknown,
        sender: sendLiveTerminalInputRef.current
      }),
    [onDeliveryUnknown, sendLiveTerminalInputRef]
  )

  useEffect(() => {
    // Why: unsent kana is safe to retain; sent prefixes and timer-held text are ambiguous after an outage.
    if (!connected) {
      reconcileLiveInputAfterDisconnect()
    }
  }, [connected, reconcileLiveInputAfterDisconnect])

  useEffect(() => {
    const pendingHandle = pendingLiveInputHandleRef.current
    if (!pendingHandle) {
      return
    }
    // Why: a lagging mobile tab list briefly yields no active tab object; a
    // null/undefined type is "unknown", not "left the terminal" — flush guards
    // still block sends if the tab truly changed.
    if (
      !activeHandle ||
      pendingHandle !== activeHandle ||
      (activeSessionTabType != null && activeSessionTabType !== 'terminal') ||
      !liveInputTerminalHandles.has(activeHandle)
    ) {
      clearPendingLiveInputCommit()
    }
  }, [activeHandle, activeSessionTabType, clearPendingLiveInputCommit, liveInputTerminalHandles])

  const sendLiveInputExternalBoundary = useCallback<TerminalLiveInputBoundarySender>(
    (handle, sendBoundary) => runLiveInputBoundary(handle, sendBoundary),
    [runLiveInputBoundary]
  )

  const handleLiveInputChange = useCallback(
    (text: string) => {
      if (!isLiveInputProducerCurrent()) {
        return
      }
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        clearPendingLiveInputCommit()
        return
      }
      // Why: iOS kills an active dictation/IME session when JS writes a value
      // that differs from the native field text, so the controlled capture must
      // echo the field verbatim; only the PTY mirror sees normalized text.
      setLiveInputCapture(text)
      applyLiveInputMirror(activeHandle, normalizeTerminalTextInput(text), text)
    },
    [
      activeHandle,
      applyLiveInputMirror,
      clearPendingLiveInputCommit,
      isLiveInputProducerCurrent,
      liveInputTerminalHandles,
      setLiveInputCapture
    ]
  )

  const handleLiveInputKeyPress = useCallback(
    (event: TerminalLiveInputKeyPressEvent) => {
      if (!isLiveInputProducerCurrent()) {
        return
      }
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        return
      }
      const ownsPendingState = pendingLiveInputHandleRef.current === activeHandle
      if (pendingLiveInputHandleRef.current && !ownsPendingState) {
        clearPendingLiveInputCommit()
      }
      const decision = getTerminalLiveSpecialKeyDecision({
        key: event.nativeEvent.key,
        heldText: ownsPendingState ? heldLiveInputTextRef.current : '',
        sentText: ownsPendingState ? currentLiveInputFieldTextRef.current : ''
      })
      switch (decision.kind) {
        case 'ignore':
        case 'local-edit':
          return
        case 'send-now':
        case 'commit-held-then-send':
          void runLiveInputBoundary(
            activeHandle,
            (isBoundaryCurrent) =>
              sendLiveInputBoundaryBytes(activeHandle, decision.bytes, isBoundaryCurrent),
            decision.bytes
          )
          return
        default:
          decision satisfies never
      }
    },
    [
      activeHandle,
      clearPendingLiveInputCommit,
      currentLiveInputFieldTextRef,
      isLiveInputProducerCurrent,
      liveInputTerminalHandles,
      runLiveInputBoundary,
      sendLiveInputBoundaryBytes
    ]
  )

  const handleLiveInputAccessoryBytes = useTerminalLiveAccessoryInputCommit({
    activeHandle,
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    currentLiveInputFieldTextRef,
    heldLiveInputTextRef,
    isLiveInputProducerCurrent,
    liveInputRef,
    liveInputTerminalHandles,
    pendingLiveInputHandleRef,
    runLiveInputBoundary,
    sentLiveInputTextRef,
    sendLiveInputBoundaryBytes,
    setLiveInputCapture,
    waitForPendingLiveInputFlush
  })

  const handleLiveInputSubmit = useCallback(() => {
    if (
      !isLiveInputProducerCurrent() ||
      !activeHandle ||
      !liveInputTerminalHandles.has(activeHandle)
    ) {
      return
    }
    void runLiveInputBoundary(
      activeHandle,
      (isBoundaryCurrent) => sendLiveInputBoundaryBytes(activeHandle, '\r', isBoundaryCurrent),
      '\r'
    )
  }, [
    activeHandle,
    isLiveInputProducerCurrent,
    liveInputTerminalHandles,
    runLiveInputBoundary,
    sendLiveInputBoundaryBytes
  ])

  return {
    clearPendingLiveInputCommit,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    liveInputProducerGeneration,
    sendLiveInputExternalBoundary
  }
}
