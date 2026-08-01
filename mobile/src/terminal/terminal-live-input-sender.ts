export type TerminalLiveInputSendOutcome = 'accepted' | 'rejected' | 'unknown'

export function isTerminalLiveInputSendAccepted(outcome: TerminalLiveInputSendOutcome): boolean {
  return outcome === 'accepted'
}

export type TerminalLiveInputSender = (
  handle: string,
  bytes: string
) => Promise<TerminalLiveInputSendOutcome>

export type TerminalLiveInputBoundaryCurrent = () => boolean

export type TerminalLiveInputBoundarySend = (
  isBoundaryCurrent: TerminalLiveInputBoundaryCurrent
) => Promise<boolean>

export type TerminalLiveInputBoundarySender = (
  handle: string,
  sendBoundary: TerminalLiveInputBoundarySend
) => Promise<boolean>
