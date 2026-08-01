import type { RpcClient } from '../transport/rpc-client'
import type { TerminalLiveInputSendOutcome } from './terminal-live-input-sender'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from './terminal-send-request'
import {
  getTerminalSendRpcFailureOutcome,
  getTerminalSendRpcResponseOutcome
} from './terminal-send-rpc-outcome'

export type MobileTerminalBufferedInputSendOutcome = TerminalLiveInputSendOutcome

export async function sendMobileTerminalBufferedInput(args: {
  readonly client: Pick<RpcClient, 'sendRequest'>
  readonly deviceToken: string | null
  readonly targetHandle: string
  readonly text: string
}): Promise<MobileTerminalBufferedInputSendOutcome> {
  try {
    const response = await args.client.sendRequest(
      'terminal.send',
      buildTerminalSendParams({
        terminal: args.targetHandle,
        text: args.text,
        enter: true,
        deviceToken: args.deviceToken
      }),
      TERMINAL_INPUT_SEND_OPTIONS
    )
    return getTerminalSendRpcResponseOutcome(response)
  } catch (error) {
    return getTerminalSendRpcFailureOutcome(error)
  }
}

export function mergeRejectedTerminalBufferedInput(sentText: string, currentText: string): string {
  if (currentText.length === 0) {
    return sentText
  }
  if (sentText.length === 0) {
    return currentText
  }
  return `${sentText}\n${currentText}`
}
