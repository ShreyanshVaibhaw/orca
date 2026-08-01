import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcResponse } from '../transport/types'
import type { TerminalLiveInputSendOutcome } from './terminal-live-input-sender'
import { isTerminalSendRpcAccepted } from './terminal-send-rpc-response'

export function getTerminalSendRpcResponseOutcome(
  response: RpcResponse
): TerminalLiveInputSendOutcome {
  return isTerminalSendRpcAccepted(response) ? 'accepted' : 'rejected'
}

export function getTerminalSendRpcFailureOutcome(
  error: unknown
): Exclude<TerminalLiveInputSendOutcome, 'accepted'> {
  return isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error) ? 'unknown' : 'rejected'
}
