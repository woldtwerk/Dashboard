import { lookup } from 'node:dns/promises'
import { findServices } from '../../../core/server/db/service-repository'
import type { ServiceRow } from '../../../core/server/db/service-repository'
import { getService } from '../../../core/server/utils/services'
import type { DavUpstream, MailUpstream } from './handle-auth'

/** The connectors of the proton-dav layer whose service stores carbonate's DAV credentials. */
const CARBONATE_CONNECTORS = new Set(['carbonate-calendar', 'carbonate-contacts'])

/** The connector of the mail-proton layer; its service stores the Bridge mailbox. */
const PROTON_MAIL_CONNECTOR = 'proton'

/** The Bridge container's hostname, used when the stored service has none. */
const DEFAULT_MAIL_HOST = 'proton-bridge'

async function firstServiceOf(domain: string, match: (row: ServiceRow) => boolean): Promise<ServiceRow | undefined> {
  const services = await findServices(await useDb(), domain)

  return services.find(match)
}

/**
 * The DAV credentials of the first carbonate service, whichever of calendar or
 * contacts signed the account in. They are what the proxy authenticates to
 * carbonate with; the real Proton password is never stored.
 */
export async function findDavUpstream(): Promise<DavUpstream | undefined> {
  const service = await firstServiceOf('calendar', row => CARBONATE_CONNECTORS.has(row.connector))
    ?? await firstServiceOf('contacts', row => CARBONATE_CONNECTORS.has(row.connector))
  if (!service) {
    return undefined
  }

  const { values } = await getService(service.id)
  const username = String(values.username ?? '')
  const password = String(values.password ?? '')

  return username && password ? { username, password } : undefined
}

/**
 * The Bridge mailbox of the first Proton mail service. The proxy uses these
 * credentials for the backend IMAP/SMTP connection; the client only ever sees
 * its own app password.
 */
export async function findMailUpstream(): Promise<MailUpstream | undefined> {
  const service = await firstServiceOf('mail', row => row.connector === PROTON_MAIL_CONNECTOR)
  if (!service) {
    return undefined
  }

  const { values } = await getService(service.id)
  const user = String(values.user ?? '')
  const password = String(values.password ?? '')

  return user && password
    ? { host: String(values.host ?? '') || DEFAULT_MAIL_HOST, user, password }
    : undefined
}

/**
 * The IPv4 address of a host. nginx mail's `Auth-Server` must be an address,
 * not a name, so the container name the app uses is resolved here.
 */
export async function resolveHostIpv4(host: string): Promise<string | undefined> {
  try {
    const { address } = await lookup(host, { family: 4 })
    return address
  } catch {
    return undefined
  }
}
