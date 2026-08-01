import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputSender
} from './terminal-live-input-sender'

type TerminalLiveBoundaryByteSendOptions = {
  readonly bytes: string
  readonly handle: string
  readonly isBoundaryCurrent: TerminalLiveInputBoundaryCurrent
  readonly onDeliveryUnknown?: () => void
  readonly sender: TerminalLiveInputSender
}

export type TerminalLiveBoundaryByteSender = (
  handle: string,
  bytes: string,
  isBoundaryCurrent: TerminalLiveInputBoundaryCurrent
) => Promise<boolean>

export async function sendTerminalLiveBoundaryBytes({
  bytes,
  handle,
  isBoundaryCurrent,
  onDeliveryUnknown,
  sender
}: TerminalLiveBoundaryByteSendOptions): Promise<boolean> {
  if (!isBoundaryCurrent()) {
    return false
  }
  let outcome
  try {
    outcome = await sender(handle, bytes)
  } catch {
    outcome = 'unknown' as const
  }
  const outcomeCurrent = isBoundaryCurrent.reportSendOutcome
    ? isBoundaryCurrent.reportSendOutcome(outcome)
    : isBoundaryCurrent()
  if (!outcomeCurrent) {
    return false
  }
  if (outcome === 'unknown') {
    onDeliveryUnknown?.()
  }
  return isBoundaryCurrent() && outcome === 'accepted'
}
