import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import type { PeerCertificate } from 'node:tls'
import { ImapFlow } from 'imapflow'
import type { MessageAddressObject } from 'imapflow'
import type { AddressObject } from 'mailparser'
import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { MailAddress, MailSummary } from '../../../mail/shared/types/mail'

export interface ProtonSettings {
  host: string
  port: number
  /** Bridge's SMTP submission port; defaults to 1026 when the setup has none */
  smtpPort?: number
  user: string
  password: string
  /** PEM encoded certificate exported from Bridge */
  tlsCert?: string
  allowSelfSigned: boolean
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export const isLoopbackHost = (host: string) => LOOPBACK_HOSTS.has(host)

export function toProtonSettings(values: SetupValues): ProtonSettings {
  return {
    host: String(values.host ?? ''),
    port: Number(values.port),
    smtpPort: values.smtpPort ? Number(values.smtpPort) : undefined,
    user: String(values.user ?? ''),
    password: String(values.password ?? ''),
    tlsCert: values.tlsCert ? String(values.tlsCert) : undefined,
    allowSelfSigned: values.allowSelfSigned === true
  }
}

/** The TLS servername to verify; an IP host is left to the certificate's IP SAN */
export function bridgeServername(host: string): string | undefined {
  return isIP(host) ? undefined : host
}

/**
 * The TLS options both Bridge clients use. The exported certificate is pinned as
 * the only CA, so it already proves the server holds Bridge's key; a Bridge
 * reached by another name (its container) may also match 127.0.0.1. Only set
 * with a certificate: tls.connect rejects an explicit undefined.
 */
export function bridgeTlsOptions({ tlsCert, allowSelfSigned }: Pick<ProtonSettings, 'tlsCert' | 'allowSelfSigned'>) {
  return {
    ca: tlsCert || undefined,
    rejectUnauthorized: !allowSelfSigned,
    ...tlsCert && {
      checkServerIdentity: (name: string, cert: PeerCertificate) => checkServerIdentity(name, cert) && checkServerIdentity('127.0.0.1', cert)
    }
  }
}

function createClient({ host, port, user, password, tlsCert, allowSelfSigned }: ProtonSettings): ImapFlow {
  if (!user || !password) {
    throw createError({ status: 503, statusText: 'Proton Bridge credentials are missing' })
  }

  if (allowSelfSigned && !isLoopbackHost(host)) {
    throw createError({ status: 500, statusText: 'allowSelfSigned is only permitted for loopback hosts' })
  }

  return new ImapFlow({
    host,
    port,
    secure: false,
    // Never send Bridge credentials in cleartext
    doSTARTTLS: true,
    servername: bridgeServername(host),
    auth: { user, pass: password },
    tls: bridgeTlsOptions({ tlsCert, allowSelfSigned }),
    logger: false
  })
}

function describeConnectError(error: unknown, { host, port }: ProtonSettings): string {
  const { code, authenticationFailed } = (error ?? {}) as { code?: string, authenticationFailed?: boolean }

  if (authenticationFailed) {
    return 'Authentication failed. Check the Bridge username and password.'
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return `Proton Bridge is not reachable at ${host}:${port}. Is it running?`
  }
  if (code && /CERT|SELF_SIGNED|DEPTH_ZERO|TLS/i.test(code)) {
    return 'The TLS certificate is not trusted. Provide the certificate exported from Bridge.'
  }
  return 'Could not connect to Proton Bridge'
}

/**
 * The underlying reason of a failed connect, for the log: the user-facing text is
 * deliberately coarse, but a refusal or a dropped handshake must stay traceable.
 * Only the error's own fields are logged, never the settings (which hold the password).
 */
function connectErrorMeta(error: unknown, { host, port }: ProtonSettings) {
  const { code, message, responseText } = (error ?? {}) as { code?: string, message?: string, responseText?: string }
  return { host, port, code, message, responseText }
}

async function connect(settings: ProtonSettings): Promise<ImapFlow> {
  const client = createClient(settings)

  try {
    await client.connect()
  } catch (error) {
    // Logged once, where the status text is chosen; `cause` keeps the original for callers
    console.warn('[proton-bridge] connect failed', connectErrorMeta(error, settings))
    throw createError({ status: 502, statusText: describeConnectError(error, settings), cause: error })
  }

  return client
}

/**
 * Opens a connection the caller closes itself. A streaming download must keep
 * the connection (and its mailbox lock) until the stream ends, so it cannot use
 * `withProtonBridge`, which logs out as soon as its callback returns.
 */
export async function openProtonConnection(settings: ProtonSettings): Promise<ImapFlow> {
  return connect(settings)
}

/** Opens and closes a connection to verify the settings. */
export async function testProtonConnection(settings: ProtonSettings): Promise<void> {
  const client = await connect(settings)
  await client.logout().catch(() => client.close())
}

export async function withProtonBridge<T>(settings: ProtonSettings, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await connect(settings)

  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

export async function withProtonMailbox<T>(settings: ProtonSettings, mailbox: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  return withProtonBridge(settings, async (client) => {
    const lock = await client.getMailboxLock(mailbox).catch((error) => {
      throw createError({ status: 404, statusText: `Mailbox "${mailbox}" not found`, cause: error })
    })

    try {
      return await fn(client)
    } finally {
      lock.release()
    }
  })
}

export function toMailAddresses(addresses?: MessageAddressObject[] | AddressObject | AddressObject[]): MailAddress[] {
  if (!addresses) {
    return []
  }

  // mailparser returns AddressObject(s) with a `value` list, imapflow envelopes a plain list
  const list = Array.isArray(addresses) ? addresses : [addresses]

  return list.flatMap(entry => 'value' in entry ? entry.value : [entry])
    .map(({ name, address }) => ({ name: name || undefined, address: address || undefined }))
}

/**
 * Whether opening a mailbox failed only because it does not exist. A server
 * answers the RFC 5530 `[NONEXISTENT]` code, or only says so in its text.
 */
export function isMailboxNotFoundError(error: unknown): boolean {
  const value = error as { serverResponseCode?: string, response?: unknown, message?: string } | undefined
  if (!value) {
    return false
  }
  if (value.serverResponseCode === 'NONEXISTENT') {
    return true
  }
  const text = typeof value.response === 'string' ? value.response : value.message ?? ''
  return /mailbox (does not exist|not found)|no such mailbox|nonexistent/i.test(text)
}

/**
 * Whether a `CREATE` failed only because the folder already exists. ImapFlow
 * itself answers an RFC 5530 `[ALREADYEXISTS]` with `{ created: false }`; a
 * server that only says "Mailbox already exists" reaches us as an error.
 */
export function isMailboxExistsError(error: unknown): boolean {
  const value = error as { serverResponseCode?: string, response?: unknown, message?: string } | undefined
  if (!value) {
    return false
  }
  if (value.serverResponseCode === 'ALREADYEXISTS') {
    return true
  }
  const text = typeof value.response === 'string' ? value.response : value.message ?? ''
  return /already exists/i.test(text)
}

export function toMailSummary(mailbox: string, message: {
  uid: number
  flags?: Set<string>
  envelope?: { subject?: string, from?: MessageAddressObject[], date?: Date | string, messageId?: string }
  internalDate?: Date | string
}): MailSummary {
  return {
    uid: message.uid,
    mailbox,
    messageId: message.envelope?.messageId || undefined,
    subject: message.envelope?.subject ?? '',
    from: toMailAddresses(message.envelope?.from),
    date: new Date(message.envelope?.date ?? message.internalDate ?? Date.now()).toISOString(),
    unread: !message.flags?.has('\\Seen'),
    flagged: !!message.flags?.has('\\Flagged')
  }
}
