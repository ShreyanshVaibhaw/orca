import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { attachMobileImageToTerminal } from './mobile-image-attachment'
import { useMobileImageAttachment } from './use-mobile-image-attachment'

vi.mock('./mobile-image-attachment', () => ({
  attachMobileImageToTerminal: vi.fn()
}))
vi.mock('./mobile-image-source-picker', () => ({
  ImageLibraryPermissionError: class extends Error {},
  pickMobileImage: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('does not replace a boundary-handled attachment uncertainty with a failure toast', async () => {
  vi.mocked(attachMobileImageToTerminal).mockResolvedValue(false)
  const onError = vi.fn()
  const onSuccess = vi.fn()
  const showToast = vi.fn()
  let attachImage: ((source: 'library') => Promise<void>) | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    attachImage = useMobileImageAttachment({
      client: {} as RpcClient,
      activeHandle: 'terminal-a',
      canSend: true,
      connState: 'connected',
      deviceTokenRef: { current: 'device-a' },
      getActiveWorktreeConnectionId: async () => null,
      showToast,
      onSuccess,
      onError,
      sendTerminalBoundary: vi.fn()
    }).attachImage
    return null
  }

  const originalConsoleError = console.error
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      originalConsoleError(...args)
    }
  })
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    errorSpy.mockRestore()
  }
  if (!attachImage) {
    throw new Error('mobile image attachment hook did not render')
  }

  await act(async () => attachImage?.('library'))

  expect(onError).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
  expect(showToast).not.toHaveBeenCalled()
  act(() => renderer?.unmount())
})
