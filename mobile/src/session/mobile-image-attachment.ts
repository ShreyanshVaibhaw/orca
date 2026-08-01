import type { RpcClient } from '../transport/rpc-client'
import {
  buildMobileImagePastePayload,
  saveMobileClipboardImageAsTempFile
} from './mobile-clipboard-image'
import type { MobileImageSource, PickedMobileImage } from './mobile-image-source-picker'
import {
  reportTerminalLiveInputBoundaryOutcome,
  type TerminalLiveInputBoundarySender
} from '../terminal/terminal-live-input-sender'
import {
  getTerminalSendRpcFailureOutcome,
  getTerminalSendRpcResponseOutcome
} from '../terminal/terminal-send-rpc-outcome'
import { sendMobileTerminalPasteRequest } from './mobile-terminal-paste-request'

export type AttachMobileImageDeps = {
  readonly client: Pick<RpcClient, 'sendRequest'>
  readonly terminal: string
  readonly deviceToken: string | null
  readonly getConnectionId: () => Promise<string | null>
  // Injected so this module stays free of expo/react-native imports (and unit-testable).
  readonly pickImage: (source: MobileImageSource) => Promise<PickedMobileImage | null>
  // Fired once the user has picked an image and the host upload is about to
  // start — lets the UI show a sending spinner only for the transfer, not the
  // (potentially long) time the picker is open.
  readonly onUploadStart?: () => void
  readonly sendTerminalBoundary?: TerminalLiveInputBoundarySender
}

// Uploads a picked image to the host and pastes the resulting file path into the
// active terminal — the same bracketed-path payload desktop image paste sends, so
// TUIs (Claude Code, etc.) attach it exactly as a desktop paste. Returns false
// when the user cancelled the picker.
export async function attachMobileImageToTerminal(
  source: MobileImageSource,
  {
    client,
    terminal,
    deviceToken,
    getConnectionId,
    pickImage,
    onUploadStart,
    sendTerminalBoundary
  }: AttachMobileImageDeps
): Promise<boolean> {
  const picked = await pickImage(source)
  if (!picked) {
    return false
  }
  // Why: selection is the user-intent boundary; later terminal input must not overtake its upload.
  const uploadAndSend: Parameters<TerminalLiveInputBoundarySender>[1] = async (
    isBoundaryCurrent
  ) => {
    if (!isBoundaryCurrent()) {
      return false
    }
    onUploadStart?.()
    const connectionId = await getConnectionId()
    if (!isBoundaryCurrent()) {
      return false
    }
    const imagePath = await saveMobileClipboardImageAsTempFile(client, picked.base64, {
      connectionId
    })
    if (!isBoundaryCurrent()) {
      return false
    }
    // Why: generated image paths always use desktop-compatible bracketed paste.
    const payload = buildMobileImagePastePayload(imagePath)
    try {
      const response = await sendMobileTerminalPasteRequest(client, {
        terminal,
        text: payload,
        deviceToken
      })
      return reportTerminalLiveInputBoundaryOutcome(
        isBoundaryCurrent,
        getTerminalSendRpcResponseOutcome(response)
      )
    } catch (error) {
      reportTerminalLiveInputBoundaryOutcome(
        isBoundaryCurrent,
        getTerminalSendRpcFailureOutcome(error)
      )
      throw error
    }
  }
  return sendTerminalBoundary
    ? sendTerminalBoundary(terminal, uploadAndSend)
    : uploadAndSend(() => true)
}
