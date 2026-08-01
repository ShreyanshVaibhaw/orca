import type { RpcClient } from '../transport/rpc-client'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { ConnectionState } from '../transport/types'
import type { TerminalLiveInputSendOutcome } from './terminal-live-input-sender'
import { isTerminalSendRpcAccepted } from './terminal-send-rpc-response'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from './terminal-send-request'

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
    .then(
      (response) => (isTerminalSendRpcAccepted(response) ? 'accepted' : 'rejected'),
      (error) =>
        isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error) ? 'unknown' : 'rejected'
    )
}
