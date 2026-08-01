import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import * as Clipboard from 'expo-clipboard'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalModes } from '../terminal/terminal-webview-contract'
import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputBoundarySender
} from '../terminal/terminal-live-input-sender'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { ConnectionState } from '../transport/types'
import { useMobileTerminalPaste } from './use-mobile-terminal-paste'

vi.mock('expo-clipboard', () => ({
  getStringAsync: vi.fn(),
  getImageAsync: vi.fn(),
  hasStringAsync: vi.fn(),
  hasImageAsync: vi.fn()
}))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '' } }))
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { PNG: 'png' }
}))

type DeferredText = {
  readonly promise: Promise<string>
  readonly resolve: (value: string) => void
}

function createDeferredText(): DeferredText {
  let resolvePromise: (value: string) => void = () => undefined
  const promise = new Promise<string>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function renderPaste(
  inputScopeRef: RefObject<string>,
  sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender = (_handle, send) =>
    send(() => true)
) {
  const sendRequest = vi.fn(async () => ({
    id: '1',
    ok: true,
    result: { send: { accepted: true } }
  }))
  const client = { sendRequest } as unknown as RpcClient
  const onError = vi.fn()
  const onSuccess = vi.fn()
  const refreshCanPaste = vi.fn()
  const showToast = vi.fn()
  let paste: (() => Promise<void>) | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    paste = useMobileTerminalPaste({
      activeHandle: 'terminal-a',
      activeHandleRef: { current: 'terminal-a' },
      activeSessionTabTypeRef: { current: 'terminal' },
      canSend: true,
      client,
      clientRef: { current: client },
      connState: 'connected',
      connStateRef: { current: 'connected' } as RefObject<ConnectionState>,
      deviceTokenRef: { current: 'device-1' },
      inputScope: 'host-a\0worktree-a',
      inputScopeRef,
      sendLiveInputExternalBoundary,
      getActiveWorktreeConnectionId: async () => null,
      onError,
      onSuccess,
      ptyModesRef: { current: new Map<string, TerminalModes>() },
      refreshCanPaste,
      showToast
    })
    return null
  }

  act(() => {
    renderer = create(createElement(Harness))
  })
  if (!paste || !renderer) {
    throw new Error('mobile terminal paste hook did not render')
  }
  return { onError, onSuccess, paste, refreshCanPaste, renderer, sendRequest, showToast }
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  const original = console.error
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      original(...args)
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  consoleErrorSpy?.mockRestore()
})

it('sends clipboard text with fail-fast terminal request options', async () => {
  vi.mocked(Clipboard.getStringAsync).mockResolvedValue('echo ready\n')
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { paste, renderer, sendRequest } = renderPaste(inputScopeRef)

  await paste()

  expect(sendRequest).toHaveBeenCalledWith(
    'terminal.send',
    {
      terminal: 'terminal-a',
      text: 'echo ready\n',
      enter: false,
      client: { id: 'device-1', type: 'mobile' }
    },
    { failWhenDisconnected: true }
  )
  act(() => renderer.unmount())
})

it('drops clipboard text when the route scope changes during the read', async () => {
  const deferredText = createDeferredText()
  vi.mocked(Clipboard.getStringAsync).mockReturnValue(deferredText.promise)
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { paste, renderer, sendRequest } = renderPaste(inputScopeRef)

  const result = paste()
  inputScopeRef.current = 'host-a\0worktree-b'
  deferredText.resolve('echo stale\n')
  await result

  expect(sendRequest).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})

it('reserves paste ordering before a deferred clipboard read', async () => {
  const deferredText = createDeferredText()
  vi.mocked(Clipboard.getStringAsync).mockReturnValue(deferredText.promise)
  const events: string[] = []
  let tail = Promise.resolve(true)
  const orderedBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
    const result = tail.then(() => send(() => true))
    tail = result.catch(() => false)
    return result
  }
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { paste, renderer, sendRequest } = renderPaste(inputScopeRef, orderedBoundary)
  sendRequest.mockImplementationOnce(async () => {
    events.push('paste')
    return { id: '1', ok: true, result: { send: { accepted: true } } }
  })

  const pasteResult = paste()
  await vi.waitFor(() => expect(Clipboard.getStringAsync).toHaveBeenCalled())
  const laterReturn = orderedBoundary('terminal-a', async () => {
    events.push('return')
    return true
  })
  await Promise.resolve()
  expect(events).toEqual([])

  await act(async () => {
    deferredText.resolve('echo paste')
    await pasteResult
  })
  await laterReturn

  expect(events).toEqual(['paste', 'return'])
  act(() => renderer.unmount())
})

it('drops a deferred paste across a producer generation ABA change', async () => {
  const deferredText = createDeferredText()
  vi.mocked(Clipboard.getStringAsync).mockReturnValue(deferredText.promise)
  let producerGeneration = Symbol('terminal-a-1')
  const boundary: TerminalLiveInputBoundarySender = (_handle, send) => {
    const reservedGeneration = producerGeneration
    return send(() => producerGeneration === reservedGeneration)
  }
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { onSuccess, paste, renderer, sendRequest } = renderPaste(inputScopeRef, boundary)

  const result = paste()
  await vi.waitFor(() => expect(Clipboard.getStringAsync).toHaveBeenCalled())
  producerGeneration = Symbol('terminal-b')
  producerGeneration = Symbol('terminal-a-2')
  deferredText.resolve('echo stale')
  await result

  expect(sendRequest).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})

it('drops a deferred paste after unmount', async () => {
  const deferredText = createDeferredText()
  vi.mocked(Clipboard.getStringAsync).mockReturnValue(deferredText.promise)
  let mounted = true
  const boundary: TerminalLiveInputBoundarySender = (_handle, send) => send(() => mounted)
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { onSuccess, paste, renderer, sendRequest } = renderPaste(inputScopeRef, boundary)

  const result = paste()
  await vi.waitFor(() => expect(Clipboard.getStringAsync).toHaveBeenCalled())
  mounted = false
  act(() => renderer.unmount())
  deferredText.resolve('echo stale')
  await result

  expect(sendRequest).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
})

it.each([
  ['an RPC failure', { ok: false, error: { code: 'stale', message: 'stale' } }],
  ['an unaccepted send', { ok: true, result: { send: { accepted: false } } }]
])('does not report paste success after %s', async (_case, response) => {
  vi.mocked(Clipboard.getStringAsync).mockResolvedValue('echo rejected\n')
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { onSuccess, paste, refreshCanPaste, renderer, sendRequest } = renderPaste(inputScopeRef)
  sendRequest.mockResolvedValueOnce(response)

  await paste()

  expect(onSuccess).not.toHaveBeenCalled()
  expect(refreshCanPaste).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})

it('reports an ambiguous physical paste send to the live-input boundary', async () => {
  vi.mocked(Clipboard.getStringAsync).mockResolvedValue('echo uncertain\n')
  const reportSendOutcome = vi.fn(() => true)
  const reportingBoundary: TerminalLiveInputBoundarySender = (_handle, send) => {
    const isBoundaryCurrent: TerminalLiveInputBoundaryCurrent = () => true
    isBoundaryCurrent.reportSendOutcome = reportSendOutcome
    return send(isBoundaryCurrent)
  }
  const inputScopeRef = { current: 'host-a\0worktree-a' }
  const { onError, paste, renderer, sendRequest, showToast } = renderPaste(
    inputScopeRef,
    reportingBoundary
  )
  sendRequest.mockRejectedValueOnce(markRpcDeliveryUnknown(new Error('response lost')))

  await paste()

  expect(reportSendOutcome).toHaveBeenCalledExactlyOnceWith('unknown')
  expect(onError).not.toHaveBeenCalled()
  expect(showToast).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})
