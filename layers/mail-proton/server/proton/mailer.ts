import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { createError } from 'nuxt/server'
import { normalizeEmail } from '../../../core/shared/entities'
import type { OutgoingMail } from '../../../mail/shared/mail-compose'
import type { MailAddress } from '../../../mail/shared/types/mail'
import { bridgeServername, bridgeTlsOptions, isLoopbackHost } from './bridge'
import type { ProtonSettings } from './bridge'

/** Bridge's SMTP submission port when the setup stores none */
export const PROTON_SMTP_PORT = 1026

/**
 * A nodemailer address object. The display name is passed as data, never as a
 * formatted `Name <address>` string: nodemailer quotes and encodes it itself, so
 * a name holding a comma, angle brackets or a line break cannot smuggle in a
 * second recipient or a header.
 */
function toMailerAddress(address: MailAddress): { name: string, address: string } {
  return { name: address.name ?? '', address: normalizeEmail(address.address)! }
}

/**
 * A submission transport for Bridge's SMTP server. It speaks plain SMTP on the
 * submission port and upgrades with STARTTLS, which `requireTLS` insists on, so
 * the credentials are never sent in cleartext. The certificate handling matches
 * the IMAP client: the exported certificate pinned as the only CA.
 */
export function createProtonTransport(settings: ProtonSettings): Transporter {
  const { host, smtpPort, user, password, tlsCert, allowSelfSigned } = settings

  if (!user || !password) {
    throw createError({ status: 503, statusText: 'Proton Bridge credentials are missing' })
  }

  if (allowSelfSigned && !isLoopbackHost(host)) {
    throw createError({ status: 500, statusText: 'allowSelfSigned is only permitted for loopback hosts' })
  }

  return nodemailer.createTransport({
    host,
    port: smtpPort ?? PROTON_SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user, pass: password },
    tls: {
      servername: bridgeServername(host),
      ...bridgeTlsOptions({ tlsCert, allowSelfSigned })
    }
  })
}

/**
 * Sends one mail through Bridge. Bridge files the sent mail in Sent itself, so
 * nothing is appended via IMAP afterwards.
 */
export async function sendProtonMail(settings: ProtonSettings, mail: OutgoingMail, from: MailAddress): Promise<{ messageId: string }> {
  const transport = createProtonTransport(settings)

  try {
    const info = await transport.sendMail({
      from: toMailerAddress(from),
      to: mail.to.map(toMailerAddress),
      cc: mail.cc.map(toMailerAddress),
      bcc: mail.bcc.map(toMailerAddress),
      subject: mail.subject,
      text: mail.text,
      inReplyTo: mail.inReplyTo,
      references: mail.references
    })

    return { messageId: info.messageId }
  } finally {
    transport.close()
  }
}
