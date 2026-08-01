import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { TerminalLiveInputSendOutcome } from './terminal-live-input-sender'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from './terminal-send-request'
import {
  getTerminalSendRpcFailureOutcome,
  getTerminalSendRpcResponseOutcome
} from './terminal-send-rpc-outcome'

type MobileTerminalLiveInputSend = {
  readonly client: Pick<RpcClient, 'sendRequest'> | null
  readonly connState: ConnectionState
  readonly targetHandle: string
  readonly activeHandle: string | null
  readonly activeSessionTabType: string | null | undefined
  readonly text: string
  readonly deviceToken: string | null
}

export function sendMobileTerminalLiveInput({
  client,
  connState,
  targetHandle,
  activeHandle,
  activeSessionTabType,
  text,
  deviceToken
}: MobileTerminalLiveInputSend): Promise<TerminalLiveInputSendOutcome> {
  if (
    !client ||
    connState !== 'connected' ||
    targetHandle !== activeHandle ||
    (activeSessionTabType != null && activeSessionTabType !== 'terminal')
  ) {
    return Promise.resolve('rejected')
  }
  return client
    .sendRequest(
      'terminal.send',
      buildTerminalSendParams({ terminal: targetHandle, text, enter: false, deviceToken }),
      TERMINAL_INPUT_SEND_OPTIONS
    )
    .then(getTerminalSendRpcResponseOutcome, getTerminalSendRpcFailureOutcome)
}
