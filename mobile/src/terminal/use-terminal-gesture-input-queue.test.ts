import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { TerminalLiveInputBoundarySender } from './terminal-live-input-sender'
import { queueTerminalLiveHandleSend } from './terminal-live-pending-flush-state'
import { useTerminalGestureInputQueue } from './use-terminal-gesture-input-queue'

const ACCEPTED_RESPONSE = {
  id: 'request',
  ok: true,
  result: { send: { accepted: true } }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function suppressRendererWarning(): () => void {
  const originalConsoleError = console.error
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      originalConsoleError(...args)
    }
  })
  return () => spy.mockRestore()
}

function createGestureQueueHarness(
  client: RpcClient,
  sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender
) {
  const activeHandleRef: RefObject<string | null> = { current: 'terminal-a' }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  let producerGeneration = Symbol('terminal-a-1')
  let controller: ReturnType<typeof useTerminalGestureInputQueue> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    controller = useTerminalGestureInputQueue({
      activeHandleRef,
      activeSessionTabTypeRef,
      clientRef: { current: client },
      connStateRef: { current: 'connected' as ConnectionState },
      deviceTokenRef: { current: 'device-a' },
      liveInputProducerGeneration: producerGeneration,
      sendLiveInputExternalBoundary
    })
    return null
  }

  const restoreConsoleError = suppressRendererWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }

  return {
    get enqueue() {
      if (!controller) {
        throw new Error('terminal gesture input hook did not render')
      }
      return controller.enqueueTerminalGestureInput
    },
    setGeneration(handle: string, label: string): void {
      activeHandleRef.current = handle
      producerGeneration = Symbol(label)
      act(() => renderer?.update(createElement(Harness)))
    },
    unmount(): void {
      act(() => renderer?.unmount())
    }
  }
}

function createScopedBoundary(inputScope: string): TerminalLiveInputBoundarySender {
  return (handle, send) => queueTerminalLiveHandleSend(inputScope, handle, () => send(() => true))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('terminal gesture input queue', () => {
  it('delivers current A exactly once after a deferred A→B→A flush', async () => {
    vi.useFakeTimers()
    const firstResponse = createDeferred<unknown>()
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue(ACCEPTED_RESPONSE)
    const client = { sendRequest } as unknown as RpcClient
    const harness = createGestureQueueHarness(
      client,
      createScopedBoundary('gesture-generation-aba')
    )

    harness.enqueue('terminal-a', 'old-a', 1)
    await act(async () => vi.advanceTimersByTimeAsync(16))
    expect(sendRequest).toHaveBeenCalledOnce()

    harness.setGeneration('terminal-b', 'terminal-b')
    harness.setGeneration('terminal-a', 'terminal-a-2')
    harness.enqueue('terminal-a', 'current-a', 1)
    await act(async () => vi.advanceTimersByTimeAsync(16))
    expect(sendRequest).toHaveBeenCalledOnce()

    await act(async () => {
      firstResponse.resolve(ACCEPTED_RESPONSE)
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2))
    await act(async () => vi.advanceTimersByTimeAsync(100))

    expect(sendRequest.mock.calls.map((call) => (call[1] as { text: string }).text)).toEqual([
      'old-a',
      'current-a'
    ])
    harness.unmount()
  })

  it('drops a gesture that expires while waiting behind the handle tail', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))
    const slowTail = createDeferred<boolean>()
    const inputScope = 'gesture-dispatch-freshness'
    const blockingSend = queueTerminalLiveHandleSend(
      inputScope,
      'terminal-a',
      () => slowTail.promise
    )
    const sendRequest = vi.fn().mockResolvedValue(ACCEPTED_RESPONSE)
    const client = { sendRequest } as unknown as RpcClient
    const harness = createGestureQueueHarness(client, createScopedBoundary(inputScope))

    harness.enqueue('terminal-a', 'stale-gesture', 1)
    await act(async () => vi.advanceTimersByTimeAsync(16))
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      slowTail.resolve(true)
      await blockingSend
      await Promise.resolve()
    })

    expect(sendRequest).not.toHaveBeenCalled()
    harness.unmount()
  })
})
