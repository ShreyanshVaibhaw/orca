import { useCallback, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import {
  getTerminalLiveAccessoryBytesDecision,
  getTerminalLiveAccessoryLocalEditText
} from './terminal-live-text-commit'
import type { TerminalLiveAccessoryInput } from './terminal-live-accessory-input'
import type { TerminalLiveBoundaryByteSender } from './terminal-live-boundary-byte-send'
import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputBoundarySender
} from './terminal-live-input-sender'

export type TerminalLiveAccessoryInputCommitResult =
  | { readonly kind: 'allow-raw' }
  | { readonly kind: 'handled' }
  | { readonly kind: 'suppress-raw' }

export type TerminalLiveAccessoryInputCommit = (
  input: TerminalLiveAccessoryInput,
  isInputCurrent?: () => boolean
) => Promise<TerminalLiveAccessoryInputCommitResult>

export async function getTerminalLiveAccessoryInactiveInputCommitResult(
  waitForPendingLiveInputFlush: () => Promise<boolean>
): Promise<TerminalLiveAccessoryInputCommitResult> {
  return (await waitForPendingLiveInputFlush()) ? { kind: 'allow-raw' } : { kind: 'suppress-raw' }
}

type TerminalLiveAccessoryInputCommitOptions = {
  readonly activeHandle: string | null
  readonly applyLiveInputMirror: (handle: string, fieldText: string) => void
  readonly clearPendingLiveInputCommit: () => void
  readonly currentLiveInputFieldTextRef: RefObject<string>
  readonly heldLiveInputTextRef: RefObject<string>
  readonly isLiveInputProducerCurrent: () => boolean
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputTerminalHandles: ReadonlySet<string>
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly runLiveInputBoundary: TerminalLiveInputBoundarySender
  readonly sentLiveInputTextRef: RefObject<string>
  readonly sendLiveInputBoundaryBytes: TerminalLiveBoundaryByteSender
  readonly setLiveInputCapture: (text: string) => void
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}

export function useTerminalLiveAccessoryInputCommit({
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
}: TerminalLiveAccessoryInputCommitOptions): TerminalLiveAccessoryInputCommit {
  return useCallback(
    async (
      input: TerminalLiveAccessoryInput,
      isInputCurrent = () => true
    ): Promise<TerminalLiveAccessoryInputCommitResult> => {
      if (!isLiveInputProducerCurrent() || !isInputCurrent()) {
        return { kind: 'suppress-raw' }
      }
      if (!activeHandle) {
        return { kind: 'allow-raw' }
      }
      if (!liveInputTerminalHandles.has(activeHandle)) {
        const inactiveResult = await getTerminalLiveAccessoryInactiveInputCommitResult(
          waitForPendingLiveInputFlush
        )
        return isLiveInputProducerCurrent() && isInputCurrent()
          ? inactiveResult
          : { kind: 'suppress-raw' }
      }
      const ownsPendingState = pendingLiveInputHandleRef.current === activeHandle
      if (pendingLiveInputHandleRef.current && !ownsPendingState) {
        clearPendingLiveInputCommit()
      }
      const heldText = ownsPendingState ? heldLiveInputTextRef.current : ''
      const sentText = ownsPendingState ? sentLiveInputTextRef.current : ''
      const fieldText = ownsPendingState ? currentLiveInputFieldTextRef.current : ''
      const decision = getTerminalLiveAccessoryBytesDecision({ ...input, heldText, sentText })
      switch (decision.kind) {
        case 'send-now':
        case 'commit-held-then-send':
          await runLiveInputBoundary(
            activeHandle,
            (isBoundaryCurrent) => {
              const isCurrent: TerminalLiveInputBoundaryCurrent = () =>
                isInputCurrent() && isBoundaryCurrent()
              isCurrent.reportSendOutcome = isBoundaryCurrent.reportSendOutcome
              return sendLiveInputBoundaryBytes(activeHandle, decision.bytes, isCurrent)
            },
            decision.bytes
          )
          return { kind: 'handled' }
        case 'local-edit': {
          const editedText = getTerminalLiveAccessoryLocalEditText({
            localEdit: decision.localEdit,
            fieldText
          })
          // Why: accessory buttons do not emit native TextInput edits, so the
          // field is edited here and the mirror diff syncs the PTY echo.
          setLiveInputCapture(editedText)
          liveInputRef.current?.setNativeProps({ text: editedText })
          applyLiveInputMirror(activeHandle, editedText)
          return { kind: 'handled' }
        }
        default:
          decision satisfies never
          return { kind: 'handled' }
      }
    },
    [
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
    ]
  )
}
