import { expect, it, vi } from 'vitest'
import type {
  TerminalLiveInputBoundaryCurrent,
  TerminalLiveInputSendOutcome
} from './terminal-live-input-sender'
import { sendTerminalLiveBoundaryBytes } from './terminal-live-boundary-byte-send'

it('reports an unknown send after a repeating action is released', async () => {
  let resolveSend: (outcome: TerminalLiveInputSendOutcome) => void = () => undefined
  const send = new Promise<TerminalLiveInputSendOutcome>((resolve) => {
    resolveSend = resolve
  })
  let repeatCurrent = true
  const isBoundaryCurrent: TerminalLiveInputBoundaryCurrent = () => repeatCurrent
  const reportSendOutcome = vi.fn(() => true)
  isBoundaryCurrent.reportSendOutcome = reportSendOutcome
  const onDeliveryUnknown = vi.fn()
  const result = sendTerminalLiveBoundaryBytes({
    bytes: '\x7f',
    handle: 'terminal-a',
    isBoundaryCurrent,
    onDeliveryUnknown,
    sender: async () => send
  })

  repeatCurrent = false
  resolveSend('unknown')

  await expect(result).resolves.toBe(false)
  expect(reportSendOutcome).toHaveBeenCalledExactlyOnceWith('unknown')
  expect(onDeliveryUnknown).toHaveBeenCalledOnce()
})
