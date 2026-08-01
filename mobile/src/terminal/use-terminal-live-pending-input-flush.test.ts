import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { expect, it, vi } from 'vitest'
import {
  isTerminalLiveInputSendAccepted,
  type TerminalLiveInputSender,
  type TerminalLiveInputSendOutcome
} from './terminal-live-input-sender'
import { useTerminalLivePendingInputFlush } from './use-terminal-live-pending-input-flush'

const LIVE_INPUT_GENERATION = Symbol('live-input-generation')
const LIVE_INPUT_PRODUCER_GENERATION = Symbol('live-input-producer-generation')

type DeferredBoolean = {
  readonly promise: Promise<boolean>
  readonly resolve: (value: boolean) => void
}

function createDeferredBoolean(): DeferredBoolean {
  let resolvePromise: (value: boolean) => void = () => {
    throw new Error('deferred promise was resolved before initialization')
  }
  const promise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function createDeferredOutcome(): {
  promise: Promise<TerminalLiveInputSendOutcome>
  resolve: (outcome: TerminalLiveInputSendOutcome) => void
} {
  let resolvePromise: (outcome: TerminalLiveInputSendOutcome) => void = () => undefined
  const promise = new Promise<TerminalLiveInputSendOutcome>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function sendTerminalLiveInputAccepted(
  senderRef: RefObject<TerminalLiveInputSender>,
  handle: string,
  bytes: string
): Promise<boolean> {
  return isTerminalLiveInputSendAccepted(await senderRef.current(handle, bytes))
}

function suppressReactTestRendererDeprecationWarning(): () => void {
  const originalConsoleError = console.error
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
      return
    }
    originalConsoleError(...args)
  })
  return () => consoleErrorSpy.mockRestore()
}

it('reserves a slow kana boundary before a newer live-input generation', async () => {
  const activeHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set([activeHandle])
  }
  const firstSend = createDeferredBoolean()
  const sent: string[] = []
  let sendCount = 0
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      sendCount += 1
      return sendCount === 1
        ? firstSend.promise.then((sent) => (sent ? 'accepted' : 'rejected'))
        : 'accepted'
    }
  }
  const captures: string[] = []
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef,
      activeSessionTabTypeRef,
      inputStateReady: true,
      liveInputRef,
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-boundary',
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture: (text) => captures.push(text)
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror(activeHandle, 'つ')
  const firstBoundary = handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  await vi.waitFor(() => expect(sent).toEqual(['つ']))
  expect(captures.at(-1)).toBe('')

  handlers.applyLiveInputMirror(activeHandle, 'か')
  handlers.applyLiveInputMirror(activeHandle, 'かき')
  expect(sent).toEqual(['つ'])
  firstSend.resolve(true)
  await expect(firstBoundary).resolves.toBe(true)
  await vi.waitFor(() => expect(sent).toEqual(['つ', '\r', 'か']))

  await handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  expect(sent).toEqual(['つ', '\r', 'か', 'き', '\r'])
  act(() => renderer?.unmount())
})

it('preserves new kana when an old terminal boundary arrives late', async () => {
  const activeHandleRef: RefObject<string | null> = { current: 'terminal-b' }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set(['terminal-a', 'terminal-b'])
  }
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: vi.fn(async () => 'accepted')
  }
  const captures: string[] = []
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef,
      activeSessionTabTypeRef,
      inputStateReady: true,
      liveInputRef,
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-late-boundary',
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture: (text) => captures.push(text)
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror('terminal-b', 'か')
  expect(handlers.pendingLiveInputHandleRef.current).toBe('terminal-b')
  const sendBoundary = vi.fn(async () => true)

  await expect(handlers.runLiveInputBoundary('terminal-a', sendBoundary)).resolves.toBe(false)

  expect(sendBoundary).not.toHaveBeenCalled()
  expect(handlers.pendingLiveInputHandleRef.current).toBe('terminal-b')
  expect(handlers.heldLiveInputTextRef.current).toBe('か')
  expect(captures).toEqual([])
  act(() => renderer?.unmount())
})

it('cancels queued terminal sends when the hook unmounts', async () => {
  const activeHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set([activeHandle])
  }
  const firstSend = createDeferredBoolean()
  const sent: string[] = []
  let sendCount = 0
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      sendCount += 1
      return sendCount === 1
        ? firstSend.promise.then((sent) => (sent ? 'accepted' : 'rejected'))
        : 'accepted'
    }
  }
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef,
      activeSessionTabTypeRef,
      inputStateReady: true,
      liveInputRef,
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-unmount',
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture: () => undefined
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror(activeHandle, 'か')
  const boundary = handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  await vi.waitFor(() => expect(sent).toEqual(['か']))
  handlers.applyLiveInputMirror(activeHandle, 'き')
  handlers.applyLiveInputMirror(activeHandle, 'きく')

  act(() => renderer?.unmount())
  firstSend.resolve(true)

  await expect(boundary).resolves.toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(sent).toEqual(['か'])
})

it('cancels queued terminal boundaries when the connection drops', async () => {
  const activeHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set([activeHandle])
  }
  const firstSend = createDeferredBoolean()
  const sent: string[] = []
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      return sent.length === 1
        ? firstSend.promise.then((sent) => (sent ? 'accepted' : 'rejected'))
        : 'accepted'
    }
  }
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef,
      activeSessionTabTypeRef,
      inputStateReady: true,
      liveInputRef,
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-disconnect',
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture: () => undefined
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror(activeHandle, 'か')
  const boundary = handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  await vi.waitFor(() => expect(sent).toEqual(['か']))

  handlers.reconcileLiveInputAfterDisconnect()
  firstSend.resolve(true)

  await expect(boundary).resolves.toBe(false)
  expect(sent).toEqual(['か'])
  act(() => renderer?.unmount())
})

it('invalidates dependent mirror deltas after a rejected current-generation send', async () => {
  const activeHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set([activeHandle])
  }
  const firstSend = createDeferredBoolean()
  const sent: string[] = []
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      return sent.length === 1
        ? firstSend.promise.then((sent) => (sent ? 'accepted' : 'rejected'))
        : 'accepted'
    }
  }
  const captures: string[] = []
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef,
      activeSessionTabTypeRef,
      inputStateReady: true,
      liveInputRef: { current: null },
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-rejected-mirror',
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture: (text) => captures.push(text)
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror(activeHandle, 'かき')
  handlers.applyLiveInputMirror(activeHandle, 'かきく')
  captures.push('かきく')
  await vi.waitFor(() => expect(sent).toEqual(['か']))

  firstSend.resolve(false)
  await vi.waitFor(() => expect(handlers.sentLiveInputTextRef.current).toBe(''))
  expect(sent).toEqual(['か'])
  expect(captures.at(-1)).toBe('かきく')

  await handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  expect(sent).toEqual(['か', 'かきく', '\r'])
  act(() => renderer?.unmount())
})

it('clears an ambiguous mirror field and never replays it', async () => {
  const activeHandle = 'terminal-a'
  const deferredOutcome = createDeferredOutcome()
  const sent: string[] = []
  const captures: string[] = []
  const onDeliveryUnknown = vi.fn()
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      return sent.length === 1 ? deferredOutcome.promise : 'accepted'
    }
  }
  let handlers: ReturnType<typeof useTerminalLivePendingInputFlush<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLivePendingInputFlush({
      activeHandleRef: { current: activeHandle },
      activeSessionTabTypeRef: { current: 'terminal' },
      inputStateReady: true,
      liveInputRef: { current: null },
      liveInputGeneration: LIVE_INPUT_GENERATION,
      liveInputProducerGeneration: LIVE_INPUT_PRODUCER_GENERATION,
      liveInputScope: 'pending-flush-unknown-mirror',
      liveInputTerminalHandlesRef: { current: new Set([activeHandle]) },
      onDeliveryUnknown,
      sendLiveTerminalInputRef,
      setLiveInputCapture: (text) => captures.push(text)
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live pending-input hook did not render')
  }

  handlers.applyLiveInputMirror(activeHandle, 'かき')
  await vi.waitFor(() => expect(sent).toEqual(['か']))
  deferredOutcome.resolve('unknown')
  await vi.waitFor(() => expect(onDeliveryUnknown).toHaveBeenCalledOnce())

  expect(captures.at(-1)).toBe('')
  await handlers.runLiveInputBoundary(activeHandle, () =>
    sendTerminalLiveInputAccepted(sendLiveTerminalInputRef, activeHandle, '\r')
  )
  expect(sent).toEqual(['か', '\r'])
  act(() => renderer?.unmount())
})
