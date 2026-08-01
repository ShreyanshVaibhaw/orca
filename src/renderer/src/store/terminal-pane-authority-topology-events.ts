export type TerminalPaneAuthorityTopologyChange = {
  tabIds?: readonly string[]
  paneKeys?: readonly string[]
  worktreeIds?: readonly string[]
}

const listeners = new Set<(change: TerminalPaneAuthorityTopologyChange) => void>()

export function publishTerminalPaneAuthorityTopologyChange(
  change: TerminalPaneAuthorityTopologyChange
): void {
  for (const listener of listeners) {
    listener(change)
  }
}

export function onTerminalPaneAuthorityTopologyChange(
  listener: (change: TerminalPaneAuthorityTopologyChange) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
