type TerminalLiveBoundaryFieldSnapshot = {
  readonly boundaryBytes: string
  readonly captureText: string
  readonly fieldEpoch: number
  readonly fieldText: string
  readonly recoveredBoundary: TerminalLiveRecoveredBoundary | null
  readonly token: symbol
}

export type TerminalLiveRecoveredBoundary = {
  readonly boundaryBytes: string
  readonly fieldText: string
}

export type TerminalLiveBoundaryFieldRecoveryState = {
  currentCaptureText: string
  currentFieldEpoch: number
  generation: symbol
  recoveredBoundary: TerminalLiveRecoveredBoundary | null
  snapshots: TerminalLiveBoundaryFieldSnapshot[]
}

export function createTerminalLiveBoundaryFieldRecoveryState(): TerminalLiveBoundaryFieldRecoveryState {
  return {
    currentCaptureText: '',
    currentFieldEpoch: 0,
    generation: Symbol('terminal-live-boundary-field-recovery'),
    recoveredBoundary: null,
    snapshots: []
  }
}

export function resetTerminalLiveBoundaryFieldRecovery(
  state: TerminalLiveBoundaryFieldRecoveryState
): void {
  state.currentCaptureText = ''
  state.currentFieldEpoch += 1
  state.generation = Symbol('terminal-live-boundary-field-recovery')
  state.recoveredBoundary = null
  state.snapshots = []
}

export function reserveTerminalLiveBoundaryField(
  state: TerminalLiveBoundaryFieldRecoveryState,
  fieldText: string,
  boundaryBytes: string,
  recoveredBoundary: TerminalLiveRecoveredBoundary | null
): symbol {
  const token = Symbol('terminal-live-boundary-field')
  state.snapshots.push({
    boundaryBytes,
    captureText: state.currentCaptureText,
    fieldEpoch: state.currentFieldEpoch,
    fieldText,
    recoveredBoundary,
    token
  })
  state.currentCaptureText = ''
  state.currentFieldEpoch += 1
  state.recoveredBoundary = null
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
  const hasCurrentField = currentFieldText.length > 0
  const captureText = recoverable
    .map(
      (snapshot, index) =>
        snapshot.captureText +
        (index < recoverable.length - 1 || hasCurrentField ? snapshot.boundaryBytes : '')
    )
    .join('')
  const fieldText = recoverable
    .map(
      (snapshot, index) =>
        snapshot.fieldText +
        (index < recoverable.length - 1 || hasCurrentField ? snapshot.boundaryBytes : '')
    )
    .join('')
  const recoveredFieldText = fieldText + currentFieldText
  const recoveredBoundary = recoverable.at(-1)?.recoveredBoundary ?? null
  state.currentCaptureText = captureText + state.currentCaptureText
  state.recoveredBoundary =
    currentFieldText.length === 0 && recoveredBoundary?.fieldText === recoveredFieldText
      ? recoveredBoundary
      : null
  return {
    captureText: state.currentCaptureText,
    fieldText: recoveredFieldText,
    restoredBoundary: recoverable.length > 0
  }
}

export function recoverTerminalLiveRejectedBoundary(
  state: TerminalLiveBoundaryFieldRecoveryState,
  rejectedToken: symbol | null,
  boundaryBytes: string,
  currentFieldText: string
): { readonly captureText: string; readonly fieldText: string } {
  const rejectedIndex = state.snapshots.findIndex((snapshot) => snapshot.token === rejectedToken)
  const firstDependentIndex = rejectedIndex >= 0 ? rejectedIndex + 1 : 0
  const dependent = state.snapshots.slice(firstDependentIndex)
  state.snapshots = rejectedIndex >= 0 ? state.snapshots.slice(0, rejectedIndex) : []
  const captureText = dependent
    .map((snapshot) => snapshot.captureText + snapshot.boundaryBytes)
    .join('')
  const fieldText = dependent
    .map((snapshot) => snapshot.fieldText + snapshot.boundaryBytes)
    .join('')
  const recoveredFieldText = boundaryBytes + fieldText + currentFieldText
  state.currentCaptureText = boundaryBytes + captureText + state.currentCaptureText
  state.recoveredBoundary =
    currentFieldText.length === 0 ? { boundaryBytes, fieldText: recoveredFieldText } : null
  return {
    captureText: state.currentCaptureText,
    fieldText: recoveredFieldText
  }
}
