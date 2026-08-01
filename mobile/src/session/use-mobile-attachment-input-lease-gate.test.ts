import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reportTerminalLiveInputBoundaryOutcome,
  type TerminalLiveInputBoundaryCurrent,
  type TerminalLiveInputBoundarySender
} from '../terminal/terminal-live-input-sender'
import { useMobileAttachmentInputLeaseGate } from './use-mobile-attachment-input-lease-gate'

type Gate = TerminalLiveInputBoundarySender

const sendBoundary = async (): Promise<boolean> => true

describe('useMobileAttachmentInputLeaseGate', () => {
  let renderer: ReactTestRenderer | null = null
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    const original = console.error
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...(args as Parameters<typeof console.error>))
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    errorSpy?.mockRestore()
  })

  function renderGate(args: {
    connState: { current: string }
    activeHandle: { current: string | null }
    tabType: { current: string | null }
    leaseReady: { current: boolean }
    inputScope?: string
    inputScopeRef?: { current: string }
    showToast: (message: string, durationMs?: number) => void
    sendLiveInputExternalBoundary?: TerminalLiveInputBoundarySender
  }): { gate: () => Gate } {
    let gate: Gate = () => Promise.resolve(false)
    function Probe(): null {
      gate = useMobileAttachmentInputLeaseGate({
        sendLiveInputExternalBoundary:
          args.sendLiveInputExternalBoundary ?? ((_handle, send) => send(() => true)),
        inputScope: args.inputScope ?? 'host-a\0worktree-a',
        inputScopeRef: args.inputScopeRef ?? { current: 'host-a\0worktree-a' },
        connStateRef: args.connState,
        activeHandleRef: args.activeHandle,
        activeSessionTabTypeRef: args.tabType,
        nativeChatInputLeaseReadyRef: args.leaseReady,
        showToast: args.showToast
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    return { gate: () => gate }
  }

  function baseRefs(): {
    connState: { current: string }
    activeHandle: { current: string | null }
    tabType: { current: string | null }
    leaseReady: { current: boolean }
  } {
    return {
      connState: { current: 'connected' },
      activeHandle: { current: 'terminal-1' },
      tabType: { current: 'terminal' },
      leaseReady: { current: true }
    }
  }

  it('passes immediately when the lease is ready and the target is active', async () => {
    const refs = baseRefs()
    const showToast = vi.fn()
    const { gate } = renderGate({ ...refs, showToast })

    await expect(gate()('terminal-1', sendBoundary)).resolves.toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('forwards physical send outcomes through the attachment lease check', async () => {
    const refs = baseRefs()
    const reportSendOutcome = vi.fn(() => true)
    const sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
      const isBoundaryCurrent: TerminalLiveInputBoundaryCurrent = () => true
      isBoundaryCurrent.reportSendOutcome = reportSendOutcome
      return send(isBoundaryCurrent)
    }
    const { gate } = renderGate({
      ...refs,
      showToast: vi.fn(),
      sendLiveInputExternalBoundary
    })

    await gate()('terminal-1', async (isBoundaryCurrent) => {
      isBoundaryCurrent.reportSendOutcome?.('unknown')
      return false
    })

    expect(reportSendOutcome).toHaveBeenCalledWith('unknown')
  })

  it('reports an unknown send after the attachment lease is lost', async () => {
    const refs = baseRefs()
    const reportSendOutcome = vi.fn(() => true)
    const sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
      const isBoundaryCurrent: TerminalLiveInputBoundaryCurrent = () => true
      isBoundaryCurrent.reportSendOutcome = reportSendOutcome
      return send(isBoundaryCurrent)
    }
    let resolveSend = (): void => undefined
    const physicalSend = new Promise<void>((resolve) => {
      resolveSend = resolve
    })
    const started = vi.fn()
    const { gate } = renderGate({
      ...refs,
      showToast: vi.fn(),
      sendLiveInputExternalBoundary
    })
    const result = gate()('terminal-1', async (isBoundaryCurrent) => {
      started()
      await physicalSend
      return reportTerminalLiveInputBoundaryOutcome(isBoundaryCurrent, 'unknown')
    })
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())

    refs.leaseReady.current = false
    resolveSend()

    await expect(result).resolves.toBe(false)
    expect(reportSendOutcome).toHaveBeenCalledExactlyOnceWith('unknown')
  })

  it('waits out a lease-not-ready window and then sends', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const showToast = vi.fn()
    const { gate } = renderGate({ ...refs, showToast })

    const result = gate()('terminal-1', sendBoundary)
    await vi.advanceTimersByTimeAsync(200)
    refs.leaseReady.current = true
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('reserves the external boundary before waiting for the lease', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const sendLiveInputExternalBoundary = vi.fn<TerminalLiveInputBoundarySender>((_handle, send) =>
      send(() => true)
    )
    const { gate } = renderGate({
      ...refs,
      showToast: vi.fn(),
      sendLiveInputExternalBoundary
    })

    const result = gate()('terminal-1', sendBoundary)
    expect(sendLiveInputExternalBoundary).toHaveBeenCalledOnce()
    refs.leaseReady.current = true
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toBe(true)
  })

  it('surfaces a toast when the lease never recovers', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const showToast = vi.fn()
    const { gate } = renderGate({ ...refs, showToast })

    const result = gate()('terminal-1', sendBoundary)
    await vi.advanceTimersByTimeAsync(3200)
    await expect(result).resolves.toBe(false)
    expect(showToast).toHaveBeenCalledWith('Attach failed (reconnecting)', 1500)
  })

  it('drops silently when the target changes while waiting for the lease', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const showToast = vi.fn()
    const { gate } = renderGate({ ...refs, showToast })

    const result = gate()('terminal-1', sendBoundary)
    // Mid-wait the user switches tabs: the lease recovers, but for a different
    // target — the attach must not proceed against the stale handle.
    await vi.advanceTimersByTimeAsync(200)
    refs.activeHandle.current = 'terminal-2'
    refs.leaseReady.current = true
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('drops silently when the connection is lost while waiting', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const showToast = vi.fn()
    const { gate } = renderGate({ ...refs, showToast })

    const result = gate()('terminal-1', sendBoundary)
    await vi.advanceTimersByTimeAsync(200)
    refs.connState.current = 'reconnecting'
    await vi.advanceTimersByTimeAsync(3200)
    await expect(result).resolves.toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('drops silently when the route scope changes while waiting', async () => {
    const refs = baseRefs()
    refs.leaseReady.current = false
    const inputScopeRef = { current: 'host-a\0worktree-a' }
    const showToast = vi.fn()
    const sendBoundary = vi.fn(async () => true)
    const { gate } = renderGate({ ...refs, inputScopeRef, showToast })

    const result = gate()('terminal-1', sendBoundary)
    await vi.advanceTimersByTimeAsync(200)
    inputScopeRef.current = 'host-a\0worktree-b'
    refs.leaseReady.current = true
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(sendBoundary).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('revalidates the target when a queued attachment boundary executes', async () => {
    const refs = baseRefs()
    const showToast = vi.fn()
    let runQueuedBoundary = async (): Promise<boolean> => {
      throw new Error('attachment boundary was not queued')
    }
    let resolveQueuedResult: (value: boolean) => void = () => {
      throw new Error('attachment boundary result was not initialized')
    }
    const queuedResult = new Promise<boolean>((resolve) => {
      resolveQueuedResult = resolve
    })
    const sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
      runQueuedBoundary = async () => {
        const result = await send(() => true)
        resolveQueuedResult(result)
        return result
      }
      return queuedResult
    }
    const { gate } = renderGate({
      ...refs,
      showToast,
      sendLiveInputExternalBoundary
    })
    const sendBoundary = vi.fn(async () => true)

    const result = gate()('terminal-1', sendBoundary)
    refs.activeHandle.current = 'terminal-2'

    await expect(runQueuedBoundary()).resolves.toBe(false)
    await expect(result).resolves.toBe(false)
    expect(sendBoundary).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('revalidates the route scope when a queued attachment boundary executes', async () => {
    const refs = baseRefs()
    const inputScopeRef = { current: 'host-a\0worktree-a' }
    let runQueuedBoundary = async (): Promise<boolean> => {
      throw new Error('attachment boundary was not queued')
    }
    let resolveQueuedResult: (value: boolean) => void = () => {
      throw new Error('attachment boundary result was not initialized')
    }
    const queuedResult = new Promise<boolean>((resolve) => {
      resolveQueuedResult = resolve
    })
    const sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
      runQueuedBoundary = async () => {
        const result = await send(() => true)
        resolveQueuedResult(result)
        return result
      }
      return queuedResult
    }
    const { gate } = renderGate({
      ...refs,
      inputScopeRef,
      showToast: vi.fn(),
      sendLiveInputExternalBoundary
    })
    const sendBoundary = vi.fn(async () => true)

    const result = gate()('terminal-1', sendBoundary)
    inputScopeRef.current = 'host-a\0worktree-b'

    await expect(runQueuedBoundary()).resolves.toBe(false)
    await expect(result).resolves.toBe(false)
    expect(sendBoundary).not.toHaveBeenCalled()
  })
})
