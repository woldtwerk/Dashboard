import type { LocationQueryRaw } from 'vue-router'

/** The attachment a URL's `?att=` names, and the mail it belongs to */
export interface MailAttachmentPreview {
  part: string
  uid: number
  mailbox: string
}

/** The API URL of one attachment; `inline` asks for a safe preview response. */
export function mailAttachmentUrl(
  service: string,
  mailbox: string,
  uid: number,
  part: string,
  inline = false
): string {
  const params = new URLSearchParams({ service, mailbox, part })
  if (inline) {
    params.set('inline', '1')
  }
  return `/api/mail/messages/${uid}/attachment?${params.toString()}`
}

/**
 * The preview the URL asks for. `attuid`/`attbox` identify the mail in a
 * conversation view, where the URL has no `uid`; a link without them falls back
 * to the mail the page already has open.
 */
export function mailAttachmentPreviewFromQuery(
  query: LocationQueryRaw,
  fallback?: { uid: number, mailbox: string }
): MailAttachmentPreview | null {
  const part = typeof query.att === 'string' ? query.att : undefined
  if (!part) {
    return null
  }

  const uid = typeof query.attuid === 'string' ? Number(query.attuid) : fallback?.uid
  const mailbox = typeof query.attbox === 'string' ? query.attbox : fallback?.mailbox
  if (!uid || !Number.isInteger(uid) || uid <= 0 || !mailbox) {
    return null
  }

  return { part, uid, mailbox }
}

/** The URL patch that opens, changes or closes the preview. */
export function mailAttachmentPreviewToQuery(preview: MailAttachmentPreview | null): LocationQueryRaw {
  return {
    att: preview?.part,
    attuid: preview ? String(preview.uid) : undefined,
    attbox: preview?.mailbox
  }
}

/** Gives an attachment to the browser's downloader. */
export function downloadMailAttachment(url: string, filename?: string): void {
  if (typeof document === 'undefined') {
    return
  }

  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  if (filename) {
    link.download = filename
  }
  document.body.append(link)
  link.click()
  link.remove()
}
