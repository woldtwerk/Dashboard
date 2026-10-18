import type { SetupValues } from '../../../core/shared/types/setup'

/** An account signed in to the Bridge container, as its control API returns it */
export interface BridgeAccount {
  /** Bridge's name for the account, used to look it up again */
  account: string
  imap: { username: string, password: string, port: number }
  /** SMTP port Bridge exposes next to IMAP; the credentials are the same */
  smtp?: { port: number }
  /** PEM certificate of Bridge's IMAP server */
  cert: string
}

/** Service values for an account; the IMAP password is left out, the server fetches it on save */
export function toBridgeValues({ account, imap, smtp, cert }: BridgeAccount, controlUrl: string): SetupValues {
  return {
    account,
    host: new URL(controlUrl).hostname,
    port: imap.port,
    smtpPort: smtp?.port ?? 1026,
    user: imap.username,
    tlsCert: cert.trim()
  }
}

/** Message and missing input from an error of the control API */
export function toBridgeError(status: number | undefined, data: unknown): { status: number, message: string, need?: string } {
  const { error, need } = (data ?? {}) as { error?: string, need?: string | null }

  if (!status) {
    return { status: 503, message: 'The Proton Bridge container is not reachable. Is it running?' }
  }

  return { status, message: error || 'Proton Bridge could not handle the request', need: need ?? undefined }
}
