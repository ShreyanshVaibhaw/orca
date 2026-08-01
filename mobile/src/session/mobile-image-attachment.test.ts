import { describe, expect, it, vi } from 'vitest'
import type { RpcClient, SendRequestOptions } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { attachMobileImageToTerminal } from './mobile-image-attachment'

function ok(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function clientWithResponses(responses: RpcResponse[]): Pick<RpcClient, 'sendRequest'> & {
  calls: { method: string; params: unknown; options?: SendRequestOptions }[]
} {
  const calls: { method: string; params: unknown; options?: SendRequestOptions }[] = []
  return {
    calls,
    sendRequest: vi.fn(async (method: string, params?: unknown, options?: SendRequestOptions) => {
      calls.push({ method, params, options })
      const response = responses.shift()
      if (!response) {
        throw new Error(`unexpected request: ${method}`)
      }
      return response
    })
  }
}

describe('attachMobileImageToTerminal', () => {
  it('uploads the picked image and pastes its bracketed path into the terminal', async () => {
    // startImageUpload (method_not_found) falls back to single-frame saveImageAsTempFile.
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/orca-attach.png'),
      ok('send', { send: { accepted: true } })
    ])

    const sent = await attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-1',
      deviceToken: 'device-9',
      getConnectionId: async () => 'conn-7',
      pickImage: vi.fn().mockResolvedValue({ base64: 'AAAA' })
    })

    expect(sent).toBe(true)
    const sendCall = client.calls.find((c) => c.method === 'terminal.send')
    expect(sendCall?.params).toEqual({
      terminal: 'term-1',
      text: '\x1b[200~/tmp/orca-attach.png\x1b[201~',
      enter: false,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(sendCall?.options).toEqual({ failWhenDisconnected: true })
  })

  it('reserves attachment ordering before connection lookup and upload', async () => {
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/ordered.png'),
      ok('send', { send: { accepted: true } })
    ])
    const connectionId = createDeferred<string | null>()
    const getConnectionId = vi.fn(() => connectionId.promise)
    const events: string[] = []
    let tail = Promise.resolve(true)
    const orderedBoundary: NonNullable<
      Parameters<typeof attachMobileImageToTerminal>[1]['sendTerminalBoundary']
    > = (_handle, send) => {
      const result = tail.then(async () => {
        const sent = await send(() => true)
        events.push('boundary-complete')
        return sent
      })
      tail = result.catch(() => false)
      return result
    }

    const attachment = attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-ordered',
      deviceToken: null,
      getConnectionId,
      pickImage: vi.fn().mockResolvedValue({ base64: 'AAAA' }),
      sendTerminalBoundary: orderedBoundary
    })
    await vi.waitFor(() => expect(getConnectionId).toHaveBeenCalledOnce())
    const laterReturn = orderedBoundary('term-ordered', async () => {
      events.push('return')
      return true
    })

    expect(events).toEqual([])
    connectionId.resolve('conn-ordered')
    await expect(attachment).resolves.toBe(true)
    await expect(laterReturn).resolves.toBe(true)
    expect(events).toEqual(['boundary-complete', 'return', 'boundary-complete'])
  })

  it('stops a stale attachment before upload after deferred connection lookup', async () => {
    const client = clientWithResponses([])
    const connectionId = createDeferred<string | null>()
    const getConnectionId = vi.fn(() => connectionId.promise)
    let current = true
    const sendTerminalBoundary: NonNullable<
      Parameters<typeof attachMobileImageToTerminal>[1]['sendTerminalBoundary']
    > = (_handle, send) => send(() => current)

    const attachment = attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-stale',
      deviceToken: null,
      getConnectionId,
      pickImage: vi.fn().mockResolvedValue({ base64: 'AAAA' }),
      sendTerminalBoundary
    })
    await vi.waitFor(() => expect(getConnectionId).toHaveBeenCalledOnce())
    current = false
    connectionId.resolve(null)

    await expect(attachment).resolves.toBe(false)
    expect(client.calls).toEqual([])
  })

  it('passes the active worktree connectionId to the upload', async () => {
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/x.png'),
      ok('send', { send: { accepted: true } })
    ])

    await attachMobileImageToTerminal('files', {
      client,
      terminal: 'term-1',
      deviceToken: null,
      getConnectionId: async () => 'conn-ssh',
      pickImage: vi.fn().mockResolvedValue({ base64: 'BBBB' })
    })

    const saveCall = client.calls.find((c) => c.method === 'clipboard.saveImageAsTempFile')
    expect(saveCall?.params).toMatchObject({ connectionId: 'conn-ssh' })
  })

  it('does nothing and returns false when the picker is cancelled', async () => {
    const client = clientWithResponses([])

    const sent = await attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-1',
      deviceToken: null,
      getConnectionId: async () => null,
      pickImage: vi.fn().mockResolvedValue(null)
    })

    expect(sent).toBe(false)
    expect(client.calls).toEqual([])
  })

  it('omits the client field when there is no device token', async () => {
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/y.png'),
      ok('send', { send: { accepted: true } })
    ])

    await attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-2',
      deviceToken: null,
      getConnectionId: async () => null,
      pickImage: vi.fn().mockResolvedValue({ base64: 'CCCC' })
    })

    const sendCall = client.calls.find((c) => c.method === 'terminal.send')
    expect(sendCall?.params).not.toHaveProperty('client')
  })

  it('drops the image payload when the final pre-send check observes an input lease gap', async () => {
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/pending.png')
    ])
    // Why: upload can outlive the stream subscription whose acknowledgement
    // originally enabled the composer.
    const sendTerminalBoundary = vi.fn(async () => false)

    const sent = await attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-pending',
      deviceToken: null,
      getConnectionId: async () => null,
      pickImage: vi.fn().mockResolvedValue({ base64: 'DDDD' }),
      sendTerminalBoundary
    })

    expect(sent).toBe(false)
    expect(sendTerminalBoundary).toHaveBeenCalledWith('term-pending', expect.any(Function))
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
  })

  it('reports failure when the terminal rejects the uploaded image path', async () => {
    const client = clientWithResponses([
      {
        id: 'start',
        ok: false,
        error: { code: 'method_not_found', message: 'no' },
        _meta: { runtimeId: 'r' }
      },
      ok('save', '/tmp/rejected.png'),
      ok('send', { send: { accepted: false } })
    ])

    const sent = await attachMobileImageToTerminal('library', {
      client,
      terminal: 'term-rejected',
      deviceToken: null,
      getConnectionId: async () => null,
      pickImage: vi.fn().mockResolvedValue({ base64: 'EEEE' })
    })

    expect(sent).toBe(false)
  })
})
