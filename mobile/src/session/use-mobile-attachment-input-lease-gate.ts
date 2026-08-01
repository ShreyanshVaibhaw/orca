import { useCallback } from 'react'
import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputBoundarySender
} from '../terminal/terminal-live-input-sender'

type CurrentRef<T> = { readonly current: T }

type AttachmentInputLeaseGateArgs = {
  readonly sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender
  readonly inputScope: string
  readonly inputScopeRef: CurrentRef<string>
  readonly connStateRef: CurrentRef<string>
  readonly activeHandleRef: CurrentRef<string | null>
  readonly activeSessionTabTypeRef: CurrentRef<string | null>
  readonly nativeChatInputLeaseReadyRef: CurrentRef<boolean>
  readonly showToast: (message: string, durationMs?: number) => void
}

// Poll cadence + ceiling for riding out a terminal resubscribe (WS reconnect or
// return-to-terminal) during which the input lease is briefly not ready.
const LEASE_READY_POLL_MS = 100
const LEASE_READY_TIMEOUT_MS = 3000

/** Reserves the attachment behind live input, then waits for the terminal lease. */
export function useMobileAttachmentInputLeaseGate({
  sendLiveInputExternalBoundary,
  inputScope,
  inputScopeRef,
  connStateRef,
  activeHandleRef,
  activeSessionTabTypeRef,
  nativeChatInputLeaseReadyRef,
  showToast
}: AttachmentInputLeaseGateArgs): TerminalLiveInputBoundarySender {
  return useCallback(
    async (targetHandle, sendBoundary): Promise<boolean> => {
      const isTargetCurrent = (): boolean =>
        inputScope === inputScopeRef.current &&
        connStateRef.current === 'connected' &&
        targetHandle === activeHandleRef.current &&
        activeSessionTabTypeRef.current === 'terminal'
      // Why: image picking can outlive the original tab.
      if (!isTargetCurrent()) {
        return false
      }

      return sendLiveInputExternalBoundary(targetHandle, async (isBoundaryCurrent) => {
        const isAttachmentCurrent: TerminalLiveInputBoundaryCurrent = (): boolean =>
          isBoundaryCurrent() && isTargetCurrent() && nativeChatInputLeaseReadyRef.current
        isAttachmentCurrent.reportSendOutcome = isBoundaryCurrent.reportSendOutcome
        const deadline = Date.now() + LEASE_READY_TIMEOUT_MS
        while (
          isBoundaryCurrent() &&
          isTargetCurrent() &&
          !nativeChatInputLeaseReadyRef.current &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, LEASE_READY_POLL_MS))
        }
        if (!isBoundaryCurrent() || !isTargetCurrent()) {
          return false
        }
        if (nativeChatInputLeaseReadyRef.current) {
          if (!isAttachmentCurrent()) {
            return false
          }
          return sendBoundary(isAttachmentCurrent)
        }
        showToast('Attach failed (reconnecting)', 1500)
        return false
      })
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      connStateRef,
      inputScope,
      inputScopeRef,
      nativeChatInputLeaseReadyRef,
      sendLiveInputExternalBoundary,
      showToast
    ]
  )
}
