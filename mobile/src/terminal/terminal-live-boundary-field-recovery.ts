type TerminalLiveBoundaryFieldSnapshot = {
  readonly captureText: string
  readonly fieldEpoch: number
  readonly fieldText: string
  readonly token: symbol
}

export type TerminalLiveBoundaryFieldRecoveryState = {
  currentCaptureText: string
  currentFieldEpoch: number
  generation: symbol
  snapshots: TerminalLiveBoundaryFieldSnapshot[]
}

export function createTerminalLiveBoundaryFieldRecoveryState(): TerminalLiveBoundaryFieldRecoveryState {
  return {
    currentCaptureText: '',
    currentFieldEpoch: 0,
    generation: Symbol('terminal-live-boundary-field-recovery'),
    snapshots: []
  }
}

export function resetTerminalLiveBoundaryFieldRecovery(
  state: TerminalLiveBoundaryFieldRecoveryState
): void {
  state.currentCaptureText = ''
  state.currentFieldEpoch += 1
  state.generation = Symbol('terminal-live-boundary-field-recovery')
  state.snapshots = []
}

export function reserveTerminalLiveBoundaryField(
  state: TerminalLiveBoundaryFieldRecoveryState,
  fieldText: string
): symbol {
  const token = Symbol('terminal-live-boundary-field')
  state.snapshots.push({
    captureText: state.currentCaptureText,
    fieldEpoch: state.currentFieldEpoch,
    fieldText,
    token
  })
  state.currentCaptureText = ''
  state.currentFieldEpoch += 1
  return token
}

export function releaseTerminalLiveBoundaryField(
  state: TerminalLiveBoundaryFieldRecoveryState,
  token: symbol
): void {
  state.snapshots = state.snapshots.filter((snapshot) => snapshot.token !== token)
}

export function recoverTerminalLiveBoundaryFields(
  state: TerminalLiveBoundaryFieldRecoveryState,
  rejectedFieldEpoch: number,
  currentFieldText: string
): {
  readonly captureText: string
  readonly fieldText: string
  readonly restoredBoundary: boolean
} {
  const recoverable = state.snapshots.filter(
    (snapshot) => snapshot.fieldEpoch >= rejectedFieldEpoch
  )
  state.snapshots = state.snapshots.filter((snapshot) => snapshot.fieldEpoch < rejectedFieldEpoch)
  const captureText = recoverable.map((snapshot) => snapshot.captureText).join('')
  const fieldText = recoverable.map((snapshot) => snapshot.fieldText).join('')
  state.currentCaptureText = captureText + state.currentCaptureText
  return {
    captureText: state.currentCaptureText,
    fieldText: fieldText + currentFieldText,
    restoredBoundary: recoverable.length > 0
  }
}
