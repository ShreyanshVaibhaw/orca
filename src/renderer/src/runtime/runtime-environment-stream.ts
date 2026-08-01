type RuntimeEnvironmentStreamOpener = typeof window.api.runtimeEnvironments.subscribe

export const runtimeEnvironmentStream = {
  open(
    ...args: Parameters<RuntimeEnvironmentStreamOpener>
  ): ReturnType<RuntimeEnvironmentStreamOpener> {
    return window.api.runtimeEnvironments.subscribe(...args)
  }
}
