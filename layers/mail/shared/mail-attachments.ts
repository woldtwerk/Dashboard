import type { MailAttachment } from './types/mail'
import { entityKey, parseEntityKey } from '../../core/shared/entities'
import { sanitizeDriveFileName } from '../../core/shared/file-name'
import { baseMimeType } from '../../core/shared/mime'

/**
 * The part of imapflow's `MessageStructureObject` this parser reads. Declared
 * here (instead of importing imapflow into shared code) so the pure parser also
 * runs in tests without a provider.
 */
export interface MailPartStructure {
  /** Body part number, e.g. `2` or `2.1` */
  part?: string
  type?: string
  parameters?: Record<string, string>
  /** Content-ID */
  id?: string
  /** Transfer encoding, e.g. `base64` */
  encoding?: string
  /** Expected size as it travels on the wire */
  size?: number
  disposition?: string
  dispositionParameters?: Record<string, string>
  childNodes?: MailPartStructure[]
}

/** The decoded size of a part, estimated from its transfer encoding. */
export function decodedPartSize(size: number | undefined, encoding: string | undefined): number {
  if (!size) {
    return 0
  }
  return encoding?.toLowerCase() === 'base64' ? Math.floor(size * 3 / 4) : size
}

/** The name a part carries, from `Content-Disposition` or the type's `name`. */
function partFilename(node: MailPartStructure): string | undefined {
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name
  return filename?.trim() || undefined
}

/** A Content-ID without its angle brackets, lower-cased, so headers and HTML agree. */
export function normalizeContentId(contentId: string | undefined): string | undefined {
  const id = contentId?.replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
  return id || undefined
}

/** The Content-IDs an HTML body references through `cid:`. */
export function contentIdsFromHtml(html: string | undefined): Set<string> {
  const ids = new Set<string>()
  if (!html) {
    return ids
  }
  for (const match of html.matchAll(/cid:([^"'\s>)]+)/gi)) {
    const id = normalizeContentId(match[1])
    if (id) {
      ids.add(id)
    }
  }
  return ids
}

/**
 * Whether a part belongs to the body rather than the attachment list. A real
 * attachment may be sent `inline` with a filename (iOS and Apple Mail do this
 * for photos and PDFs), so only a referenced Content-ID makes a named part
 * inline. An unnamed part with a Content-ID is a body image by definition.
 */
function isInlinePart(node: MailPartStructure, referenced: ReadonlySet<string> | undefined): boolean {
  const id = normalizeContentId(node.id)
  if (id && referenced?.has(id)) {
    return true
  }
  return !!id && !partFilename(node)
}

/**
 * The attachment parts of a body structure, in wire order.
 *
 * Leaves with an attachment disposition, any leaf with a filename and embedded
 * `message/rfc822` parts are kept; a body's own `text/plain`/`text/html` part
 * has neither and is dropped. A part whose Content-ID the body references is
 * marked `inline`, so a signature logo does not count as an attachment.
 */
export function attachmentsFromStructure(node: MailPartStructure | undefined, referenced?: ReadonlySet<string>): MailAttachment[] {
  if (!node) {
    return []
  }

  const attachments: MailAttachment[] = []

  const walk = (current: MailPartStructure) => {
    const contentType = baseMimeType(current.type) || 'application/octet-stream'

    if (contentType === 'message/rfc822') {
      const name = partFilename(current)
      attachments.push({
        filename: sanitizeDriveFileName(name, contentType, attachments.length),
        contentType,
        size: decodedPartSize(current.size, current.encoding),
        part: current.part,
        inline: isInlinePart(current, referenced),
        contentId: current.id
      })
      return
    }

    if (current.childNodes?.length) {
      for (const child of current.childNodes) {
        walk(child)
      }
      return
    }

    const name = partFilename(current)
    const disposition = current.disposition?.toLowerCase()
    const isAttachment = disposition === 'attachment' || !!name
    if (!isAttachment) {
      return
    }

    attachments.push({
      filename: sanitizeDriveFileName(name, contentType, attachments.length),
      contentType,
      size: decodedPartSize(current.size, current.encoding),
      part: current.part,
      inline: isInlinePart(current, referenced),
      contentId: current.id
    })
  }

  walk(node)
  return attachments
}

/** The attachments a reader shows: real files, not inline body parts. */
export function visibleMailAttachments(attachments: MailAttachment[] | undefined): MailAttachment[] {
  return (attachments ?? []).filter(attachment => !attachment.inline && !!attachment.part)
}

/** The attachment with a given part, when it is one a reader shows. */
export function mailAttachmentByPart(attachments: MailAttachment[] | undefined, part: string | undefined): MailAttachment | undefined {
  if (!part) {
    return undefined
  }
  return visibleMailAttachments(attachments).find(attachment => attachment.part === part)
}

/** The index of a part among the visible attachments, or -1. */
export function attachmentPreviewIndex(attachments: MailAttachment[], part: string | undefined): number {
  return part ? attachments.findIndex(attachment => attachment.part === part) : -1
}

/**
 * The part one step from `part`: the next or previous visible attachment, or
 * undefined at either end. With no current part, down starts at the first and
 * up at the last.
 */
export function adjacentAttachmentPart(attachments: MailAttachment[], part: string | undefined, delta: 1 | -1): string | undefined {
  const visible = visibleMailAttachments(attachments)
  if (!visible.length) {
    return undefined
  }

  const index = attachmentPreviewIndex(visible, part)
  if (index === -1) {
    return (delta > 0 ? visible[0] : visible.at(-1))?.part
  }

  const next = visible[index + delta]
  return next?.part
}

/** The entity key other layers can use to refer to a mail, e.g. a file source ref. */
export function mailEntityRef(service: string, mailbox: string, uid: number): string {
  return entityKey({ type: 'mail', service, id: `${mailbox}/${uid}` })
}

/** The mail a file-source ref points at, or undefined when it is malformed. */
export function mailRefTarget(ref: string | null | undefined): { service: string, mailbox: string, uid: number } | undefined {
  const parsed = parseEntityKey(ref)
  if (!parsed || parsed.type !== 'mail' || !parsed.service) {
    return undefined
  }

  const at = parsed.id.lastIndexOf('/')
  const uid = Number(parsed.id.slice(at + 1))
  if (at < 0 || !Number.isInteger(uid) || uid <= 0) {
    return undefined
  }

  return { service: parsed.service, mailbox: parsed.id.slice(0, at), uid }
}
