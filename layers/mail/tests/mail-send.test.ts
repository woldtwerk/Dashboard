import { describe, expect, it, vi } from 'vitest'
import type { OutgoingMail } from '../shared/mail-compose'
import type { MailProvider } from '../server/utils/mail-provider'
import { sendMail } from '../server/utils/mail-send'

function provider(overrides: Partial<MailProvider> = {}): MailProvider {
  return {
    listMailboxes: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    setSeen: vi.fn(),
    setSeenMany: vi.fn(),
    setFlagged: vi.fn(),
    moveMessage: vi.fn(),
    moveMessages: vi.fn(),
    deleteMessage: vi.fn(),
    deleteMessages: vi.fn(),
    listMessageStates: vi.fn(),
    getMessages: vi.fn(),
    ...overrides
  } as unknown as MailProvider
}

function mail(overrides: Partial<OutgoingMail> = {}): OutgoingMail {
  return {
    to: [{ address: 'alice@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Hello',
    text: 'Body',
    ...overrides
  }
}

interface DependencyOverrides {
  provider?: MailProvider
  markAnswered?: (mailbox: string, uid: number) => Promise<void>
}

function dependencies(overrides: DependencyOverrides = {}) {
  return {
    provider: overrides.provider ?? provider({ send: vi.fn(async () => ({ messageId: '<sent@example.com>' })) }),
    from: { address: 'me@example.com' },
    markAnswered: overrides.markAnswered,
    publish: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn() }
  }
}

describe('sendMail', () => {
  it('rejects a mail without recipients before touching the provider', async () => {
    const deps = dependencies()
    const result = await sendMail(mail({ to: [] }), undefined, deps)

    expect(result).toEqual({ status: 400, error: 'At least one recipient is required' })
    expect(deps.provider.send).not.toHaveBeenCalled()
    expect(deps.publish).not.toHaveBeenCalled()
    expect(deps.logger.info).not.toHaveBeenCalled()
  })

  it('rejects a header injection in the subject or Message-ID', async () => {
    const injectedSubject = await sendMail(mail({ subject: 'Hi\r\nBcc: evil@example.com' }), undefined, dependencies())
    expect(injectedSubject.status).toBe(400)

    const injectedId = await sendMail(mail({ inReplyTo: 'a@example.com\r\nX: injected' }), undefined, dependencies())
    expect(injectedId.status).toBe(400)
  })

  it('answers 501 when the provider cannot send', async () => {
    const deps = dependencies({ provider: provider() })
    const result = await sendMail(mail(), undefined, deps)

    expect(result).toEqual({ status: 501, error: 'This mail account cannot send mail' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('sends, announces the change and logs the recipient count without addresses', async () => {
    const deps = dependencies()
    const result = await sendMail(mail({
      to: [{ address: 'alice@example.com' }],
      cc: [{ address: 'carol@example.com' }],
      bcc: [{ address: 'dave@example.com' }]
    }), undefined, deps)

    expect(result).toEqual({ status: 200, messageId: '<sent@example.com>' })
    expect(deps.provider.send).toHaveBeenCalledOnce()
    expect(deps.publish).toHaveBeenCalledOnce()
    expect(deps.logger.info).toHaveBeenCalledWith('mail sent', { recipients: 3 })

    const logged = JSON.stringify(deps.logger.info.mock.calls)
    expect(logged).not.toContain('@')
    expect(logged).not.toContain('Hello')
  })

  it('marks the replied-to mail as answered when the provider can', async () => {
    const markAnswered = vi.fn(async () => {})
    const deps = dependencies({ markAnswered })

    await sendMail(mail(), { mailbox: 'INBOX', uid: 42 }, deps)

    expect(markAnswered).toHaveBeenCalledWith('INBOX', 42)
  })

  it('skips the answered flag without a reply and without the provider capability', async () => {
    const markAnswered = vi.fn(async () => {})

    await sendMail(mail(), undefined, dependencies({ markAnswered }))
    await sendMail(mail(), { mailbox: 'INBOX', uid: 42 }, dependencies())

    expect(markAnswered).not.toHaveBeenCalled()
  })

  it('still succeeds when setting the answered flag fails', async () => {
    const deps = dependencies({
      markAnswered: vi.fn(async () => {
        throw new Error('imap down')
      })
    })

    const result = await sendMail(mail(), { mailbox: 'INBOX', uid: 42 }, deps)

    expect(result.status).toBe(200)
    expect(deps.logger.warn).toHaveBeenCalledOnce()
    expect(deps.publish).toHaveBeenCalledOnce()
  })
})
