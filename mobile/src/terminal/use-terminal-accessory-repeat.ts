import { useCallback, useLayoutEffect, useRef } from 'react'

type TerminalAccessoryKeyHandler<TInput> = (
  input: TInput,
  isRepeatCurrent: () => boolean
) => Promise<void>

type TerminalAccessoryRepeat<TInput> = {
  readonly startAccessoryRepeat: (input: TInput) => void
  readonly stopAccessoryRepeat: () => void
}

export function useTerminalAccessoryRepeat<TInput>(
  handleAccessoryKey: TerminalAccessoryKeyHandler<TInput>,
  producerGeneration: symbol
): TerminalAccessoryRepeat<TInput> {
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatSessionRef = useRef(Symbol('terminal-accessory-repeat'))
  const handleAccessoryKeyRef = useRef(handleAccessoryKey)

  useLayoutEffect(() => {
    handleAccessoryKeyRef.current = handleAccessoryKey
  }, [handleAccessoryKey])

  const stopAccessoryRepeat = useCallback(() => {
    repeatSessionRef.current = Symbol('terminal-accessory-repeat-stopped')
    if (repeatTimeoutRef.current !== null) {
      clearTimeout(repeatTimeoutRef.current)
      repeatTimeoutRef.current = null
    }
  }, [])

  const startAccessoryRepeat = useCallback(
    (input: TInput) => {
      stopAccessoryRepeat()
      const repeatSession = Symbol('terminal-accessory-repeat-active')
      repeatSessionRef.current = repeatSession
      const runRepeat = async (): Promise<void> => {
        repeatTimeoutRef.current = null
        if (repeatSessionRef.current !== repeatSession) {
          return
        }
        await handleAccessoryKeyRef.current(input, () => repeatSessionRef.current === repeatSession)
        if (repeatSessionRef.current === repeatSession) {
          repeatTimeoutRef.current = setTimeout(() => void runRepeat(), 45)
        }
      }
      repeatTimeoutRef.current = setTimeout(() => {
        void runRepeat()
      }, 400)
    },
    [stopAccessoryRepeat]
  )

  useLayoutEffect(() => {
    stopAccessoryRepeat()
  }, [producerGeneration, stopAccessoryRepeat])
  useLayoutEffect(() => stopAccessoryRepeat, [stopAccessoryRepeat])

  return { startAccessoryRepeat, stopAccessoryRepeat }
}
