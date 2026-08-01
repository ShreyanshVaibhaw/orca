import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
  TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES,
  TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS
} from '../session/mobile-session-route-helpers'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { sendMobileTerminalLiveInput } from './mobile-terminal-live-input-send'
import type { TerminalLiveInputBoundarySender } from './terminal-live-input-sender'

type TerminalGestureInputQueue = {
  bytes: string
  sequenceCount: number
  timer: ReturnType<typeof setTimeout> | null
  lastUpdatedMs: number
}

type TerminalGestureInputQueueOptions = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<string | null>
  readonly clientRef: RefObject<RpcClient | null>
  readonly connStateRef: RefObject<ConnectionState>
  readonly deviceTokenRef: RefObject<string | null>
  readonly liveInputProducerGeneration: symbol
  readonly sendLiveInputExternalBoundary: TerminalLiveInputBoundarySender
}

type TerminalGestureInputQueueController = {
  readonly clearTerminalGestureInputHandle: (handle: string) => void
  readonly enqueueTerminalGestureInput: (
    handle: string,
    bytes: string,
    sequenceCount: number
  ) => void
}

export function useTerminalGestureInputQueue({
  activeHandleRef,
  activeSessionTabTypeRef,
  clientRef,
  connStateRef,
  deviceTokenRef,
  liveInputProducerGeneration,
  sendLiveInputExternalBoundary
}: TerminalGestureInputQueueOptions): TerminalGestureInputQueueController {
  const queuesRef = useRef<Map<string, TerminalGestureInputQueue>>(new Map())
  const inFlightRef = useRef<Map<string, symbol>>(new Map())

  const clearTerminalGestureInputHandle = useCallback((handle: string) => {
    const queued = queuesRef.current.get(handle)
    if (queued?.timer !== null && queued?.timer !== undefined) {
      clearTimeout(queued.timer)
    }
    queuesRef.current.delete(handle)
    inFlightRef.current.delete(handle)
  }, [])

  const clearTerminalGestureInput = useCallback(() => {
    for (const handle of queuesRef.current.keys()) {
      clearTerminalGestureInputHandle(handle)
    }
    queuesRef.current.clear()
    inFlightRef.current.clear()
  }, [clearTerminalGestureInputHandle])

  useLayoutEffect(() => {
    clearTerminalGestureInput()
    return clearTerminalGestureInput
  }, [clearTerminalGestureInput, liveInputProducerGeneration])

  const flushTerminalGestureInput = useCallback(
    async (handle: string): Promise<void> => {
      const queued = queuesRef.current.get(handle)
      if (!queued) {
        return
      }
      if (queued.timer !== null) {
        clearTimeout(queued.timer)
        queued.timer = null
      }
      if (inFlightRef.current.has(handle)) {
        return
      }

      queuesRef.current.delete(handle)
      const isActive =
        handle === activeHandleRef.current && activeSessionTabTypeRef.current === 'terminal'
      const isFresh = Date.now() - queued.lastUpdatedMs <= TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS
      if (!clientRef.current || connStateRef.current !== 'connected' || !isActive || !isFresh) {
        return
      }

      const flushGeneration = Symbol('terminal-gesture-input-flush')
      inFlightRef.current.set(handle, flushGeneration)
      try {
        await sendLiveInputExternalBoundary(handle, () => {
          if (Date.now() - queued.lastUpdatedMs > TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS) {
            return Promise.resolve(false)
          }
          return sendMobileTerminalLiveInput({
            client: clientRef.current,
            connState: connStateRef.current,
            targetHandle: handle,
            activeHandle: activeHandleRef.current,
            activeSessionTabType: activeSessionTabTypeRef.current,
            text: queued.bytes,
            deviceToken: deviceTokenRef.current
          })
        })
      } catch {
        // Transient failure
      } finally {
        if (inFlightRef.current.get(handle) === flushGeneration) {
          inFlightRef.current.delete(handle)
          const next = queuesRef.current.get(handle)
          if (next) {
            if (Date.now() - next.lastUpdatedMs > TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS) {
              if (next.timer !== null) {
                clearTimeout(next.timer)
              }
              queuesRef.current.delete(handle)
            } else {
              void flushTerminalGestureInput(handle)
            }
          }
        }
      }
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      clientRef,
      connStateRef,
      deviceTokenRef,
      sendLiveInputExternalBoundary
    ]
  )

  const enqueueTerminalGestureInput = useCallback(
    (handle: string, bytes: string, sequenceCount: number) => {
      const now = Date.now()
      const current = queuesRef.current.get(handle)
      if (
        current &&
        current.sequenceCount + sequenceCount <= TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES
      ) {
        current.bytes += bytes
        current.sequenceCount += sequenceCount
        current.lastUpdatedMs = now
        return
      }

      if (current) {
        if (current.timer !== null) {
          clearTimeout(current.timer)
        }
        if (!inFlightRef.current.has(handle)) {
          void flushTerminalGestureInput(handle)
        } else {
          current.bytes += bytes
          current.sequenceCount += sequenceCount
          current.lastUpdatedMs = now
          current.timer = setTimeout(() => {
            current.timer = null
            void flushTerminalGestureInput(handle)
          }, TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS)
          return
        }
      }

      const queued: TerminalGestureInputQueue = {
        bytes,
        sequenceCount,
        timer: null,
        lastUpdatedMs: now
      }
      queued.timer = setTimeout(() => {
        queued.timer = null
        void flushTerminalGestureInput(handle)
      }, TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS)
      queuesRef.current.set(handle, queued)
    },
    [flushTerminalGestureInput]
  )

  return { clearTerminalGestureInputHandle, enqueueTerminalGestureInput }
}
