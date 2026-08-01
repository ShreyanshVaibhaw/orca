export type TerminalLiveInputSender = (handle: string, bytes: string) => Promise<boolean>

export type TerminalLiveInputBoundaryCurrent = () => boolean

export type TerminalLiveInputBoundarySend = (
  isBoundaryCurrent: TerminalLiveInputBoundaryCurrent
) => Promise<boolean>

export type TerminalLiveInputBoundarySender = (
  handle: string,
  sendBoundary: TerminalLiveInputBoundarySend
) => Promise<boolean>
