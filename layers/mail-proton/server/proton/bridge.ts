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
    user: String(values.user ?? ''),
    password: String(values.password ?? ''),
    tlsCert: values.tlsCert ? String(values.tlsCert) : undefined,
    allowSelfSigned: values.allowSelfSigned === true
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
    servername: isIP(host) ? undefined : host,
    auth: { user, pass: password },
    tls: {
      ca: tlsCert || undefined,
      rejectUnauthorized: !allowSelfSigned,
      // Bridge's certificate is issued for 127.0.0.1. Pinned as the only CA, it already proves the server
      // holds Bridge's key, so a Bridge reached by another name (its container) may also match 127.0.0.1.
      // Only set with a certificate: tls.connect rejects an explicit undefined.
      ...tlsCert && {
        checkServerIdentity: (name: string, cert: PeerCertificate) => checkServerIdentity(name, cert) && checkServerIdentity('127.0.0.1', cert)
      }
    },
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

async function connect(settings: ProtonSettings): Promise<ImapFlow> {
  const client = createClient(settings)

  try {
    await client.connect()
  } catch (error) {
    throw createError({ status: 502, statusText: describeConnectError(error, settings), cause: error })
  }

  return client
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

export function toMailSummary(mailbox: string, message: {
  uid: number
  flags?: Set<string>
  envelope?: { subject?: string, from?: MessageAddressObject[], date?: Date | string }
  internalDate?: Date | string
}): MailSummary {
  return {
    uid: message.uid,
    mailbox,
    subject: message.envelope?.subject ?? '',
    from: toMailAddresses(message.envelope?.from),
    date: new Date(message.envelope?.date ?? message.internalDate ?? Date.now()).toISOString(),
    unread: !message.flags?.has('\\Seen'),
    flagged: !!message.flags?.has('\\Flagged')
  }
}
