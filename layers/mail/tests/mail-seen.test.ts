import { describe, expect, it, vi } from 'vitest'
import { mailDocumentId } from '../server/mail-index/document'
import { setMailSeen, setMailSeenMany } from '../server/utils/mail-seen'

function recorder(calls: string[], name: string) {
  return vi.fn(async () => {
    calls.push(name)
  })
}

describe('setMailSeen', () => {
  it('applies the provider, then the index, then the event', async () => {
    const calls: string[] = []
    const provider = { setSeenMany: recorder(calls, 'provider') }
    const index = { updateFlags: recorder(calls, 'index') }
    const publish = recorder(calls, 'event')

    await setMailSeen('svc', 'INBOX', 42, true, { provider, index, publish, logger: { warn: vi.fn() } })

    expect(calls).toEqual(['provider', 'index', 'event'])
    expect(provider.setSeenMany).toHaveBeenCalledWith('INBOX', [42], true)
    expect(index.updateFlags).toHaveBeenCalledWith([{ id: mailDocumentId('svc', 'INBOX', 42), unread: false }])
  })

  it('marks the mail unread in the index when the seen flag is cleared', async () => {
    const provider = { setSeenMany: vi.fn(async () => {}) }
    const index = { updateFlags: vi.fn(async () => {}) }
    const publish = vi.fn(async () => {})

    await setMailSeen('svc', 'INBOX', 42, false, { provider, index, publish, logger: { warn: vi.fn() } })

    expect(provider.setSeenMany).toHaveBeenCalledWith('INBOX', [42], false)
    expect(index.updateFlags).toHaveBeenCalledWith([{ id: mailDocumentId('svc', 'INBOX', 42), unread: true }])
  })

  it('logs and swallows an index failure, still announcing the change', async () => {
    const provider = { setSeenMany: vi.fn(async () => {}) }
    const index = {
      updateFlags: vi.fn(async () => {
        throw new Error('meilisearch down')
      })
    }
    const publish = vi.fn(async () => {})
    const logger = { warn: vi.fn() }

    await expect(setMailSeen('svc', 'INBOX', 42, true, { provider, index, publish, logger })).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ error: 'meilisearch down' })
    expect(publish).toHaveBeenCalledOnce()
  })

  it('skips the index when none is registered', async () => {
    const provider = { setSeenMany: vi.fn(async () => {}) }
    const publish = vi.fn(async () => {})
    const logger = { warn: vi.fn() }

    await setMailSeen('svc', 'INBOX', 42, true, { provider, publish, logger })

    expect(provider.setSeenMany).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledOnce()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('setMailSeenMany', () => {
  it('sets every uid with one provider command, one index call and one event', async () => {
    const calls: string[] = []
    const provider = { setSeenMany: recorder(calls, 'provider') }
    const index = { updateFlags: recorder(calls, 'index') }
    const publish = recorder(calls, 'event')

    await setMailSeenMany('svc', 'INBOX', [4, 7, 9], true, { provider, index, publish, logger: { warn: vi.fn() } })

    expect(provider.setSeenMany).toHaveBeenCalledOnce()
    expect(provider.setSeenMany).toHaveBeenCalledWith('INBOX', [4, 7, 9], true)
    expect(calls).toEqual(['provider', 'index', 'event'])
    expect(index.updateFlags).toHaveBeenCalledWith([
      { id: mailDocumentId('svc', 'INBOX', 4), unread: false },
      { id: mailDocumentId('svc', 'INBOX', 7), unread: false },
      { id: mailDocumentId('svc', 'INBOX', 9), unread: false }
    ])
  })

  it('logs and swallows an index failure, still announcing the change', async () => {
    const provider = { setSeenMany: vi.fn(async () => {}) }
    const index = {
      updateFlags: vi.fn(async () => {
        throw new Error('meilisearch down')
      })
    }
    const publish = vi.fn(async () => {})
    const logger = { warn: vi.fn() }

    await expect(setMailSeenMany('svc', 'INBOX', [4, 7], false, { provider, index, publish, logger })).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledOnce()
  })
})
