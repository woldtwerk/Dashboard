import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProtonTransport, PROTON_SMTP_PORT, sendProtonMail } from '../server/proton/mailer'
import type { ProtonSettings } from '../server/proton/bridge'

const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }))

vi.mock('nodemailer', () => ({ default: { createTransport } }))

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'

function settings(overrides: Partial<ProtonSettings> = {}): ProtonSettings {
  return {
    host: '127.0.0.1',
    port: 1143,
    user: 'alice@proton.me',
    password: 'bridge-generated',
    tlsCert: CERT,
    allowSelfSigned: false,
    ...overrides
  }
}

beforeEach(() => {
  createTransport.mockReset()
  createTransport.mockReturnValue({ sendMail: vi.fn(async () => ({ messageId: '<sent@proton.me>' })), close: vi.fn() })
})

describe('createProtonTransport', () => {
  it('upgrades with STARTTLS and pins the exported certificate', () => {
    createProtonTransport(settings())

    expect(createTransport).toHaveBeenCalledOnce()
    const options = createTransport.mock.calls[0]![0]
    expect(options).toMatchObject({
      host: '127.0.0.1',
      secure: false,
      requireTLS: true,
      auth: { user: 'alice@proton.me', pass: 'bridge-generated' },
      tls: { ca: CERT, rejectUnauthorized: true }
    })
  })

  it('defaults the submission port to 1026', () => {
    createProtonTransport(settings())

    expect(createTransport.mock.calls[0]![0].port).toBe(PROTON_SMTP_PORT)
  })

  it('uses the SMTP port from the setup when it has one', () => {
    createProtonTransport(settings({ smtpPort: 1587 }))

    expect(createTransport.mock.calls[0]![0].port).toBe(1587)
  })

  it('rejects missing credentials and a non-loopback self-signed setup', () => {
    expect(() => createProtonTransport(settings({ password: '' }))).toThrow(/credentials are missing/)
    expect(() => createProtonTransport(settings({ host: 'proton-bridge', allowSelfSigned: true }))).toThrow(/loopback/)
    expect(createTransport).not.toHaveBeenCalled()
  })
})

describe('sendProtonMail', () => {
  it('maps the mail onto the SMTP envelope as address objects and returns the Message-ID', async () => {
    const mail = {
      to: [{ name: 'Alice', address: 'alice@example.com' }],
      cc: [{ address: 'carol@example.com' }],
      bcc: [],
      subject: 'Re: Hello',
      text: 'Body',
      inReplyTo: '<root@example.com>',
      references: ['<root@example.com>']
    }

    const result = await sendProtonMail(settings(), mail, { name: 'Me', address: 'me@proton.me' })

    const transport = createTransport.mock.results[0]!.value
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: { name: 'Me', address: 'me@proton.me' },
      to: [{ name: 'Alice', address: 'alice@example.com' }],
      cc: [{ name: '', address: 'carol@example.com' }],
      bcc: [],
      subject: 'Re: Hello',
      text: 'Body',
      inReplyTo: '<root@example.com>',
      references: ['<root@example.com>']
    })
    expect(transport.close).toHaveBeenCalledOnce()
    expect(result).toEqual({ messageId: '<sent@proton.me>' })
  })

  it('keeps a crafted display name inside one recipient object', async () => {
    const name = 'x, evil@example.com <"quoted">\r\nBcc: evil2@example.com'
    const mail = {
      to: [{ name, address: 'alice@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'Body'
    }

    await sendProtonMail(settings(), mail, { address: 'me@proton.me' })

    const options = createTransport.mock.results[0]!.value.sendMail.mock.calls[0]![0]
    expect(options.to).toHaveLength(1)
    expect(options.to[0]).toEqual({ name, address: 'alice@example.com' })
  })

  it('normalizes the address and leaves a nameless sender unnamed', async () => {
    const mail = {
      to: [{ name: 'Bob', address: ' BOB@Example.com ' }],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'Body'
    }

    await sendProtonMail(settings(), mail, { address: 'ME@proton.me' })

    const options = createTransport.mock.results[0]!.value.sendMail.mock.calls[0]![0]
    expect(options.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }])
    expect(options.from).toEqual({ name: '', address: 'me@proton.me' })
  })
})
