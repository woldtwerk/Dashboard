import type { FetchMessageObject, SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { MailProvider } from '../../../mail/server/utils/mail-provider'
import type { Mailbox, MailMessage, MailMessageState, MailSearch, MailStreamHeader, MailSummary } from '../../../mail/shared/types/mail'
import { mailStreamFlags, parseRawStreamHeaders } from '../../../mail/shared/mail-thread'
import { sequenceRange, uidPage } from './sequence'
import { isProtonLabel, protonSpecialUse } from './special-use'
import { toMailAddresses, toMailSummary, toProtonSettings, isMailboxExistsError, withProtonBridge, withProtonMailbox } from './bridge'
import { sendProtonMail } from './mailer'

const MESSAGE_QUERY = { uid: true, flags: true, envelope: true, internalDate: true } as const
const INDEX_SOURCE_BYTES = 256 * 1024
/** The only headers the stream backfill needs; the body is never fetched */
const STREAM_HEADERS = ['list-id', 'list-unsubscribe', 'precedence', 'auto-submitted']

/** File extensions for the media types a mail usually carries */
const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/msword': 'doc',
  'application/octet-stream': 'bin',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/calendar': 'ics',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/plain': 'txt',
  'video/mp4': 'mp4'
}

/** The media type without its parameters, lower-cased */
function baseContentType(contentType: string | undefined): string {
  return (contentType ?? 'application/octet-stream').split(';')[0]!.trim().toLocaleLowerCase()
}

/** A part without a filename gets `attachment-<n>.<ext>`, derived from its media type */
export function attachmentFileName(filename: string | undefined, contentType: string | undefined, index: number): string {
  const name = filename?.trim()
  if (name) {
    return name
  }
  const type = baseContentType(contentType)
  const subtype = type.split('/')[1]?.replace(/[^a-z0-9]+/g, '') || 'bin'
  const extension = MIME_EXTENSIONS[type] ?? subtype
  return `attachment-${index + 1}.${extension}`
}

async function toMailMessage(mailbox: string, message: FetchMessageObject): Promise<MailMessage> {
  const parsed = await simpleParser(message.source!)
  const summary = toMailSummary(mailbox, message)
  // The list and bulk headers come from the parsed headers, so a stored mail
  // carries its stream key straight from the index
  const stream = mailStreamFlags(summary.from, {
    listId: parsed.headers.get('list-id'),
    listUnsubscribe: parsed.headers.get('list-unsubscribe'),
    precedence: parsed.headers.get('precedence'),
    autoSubmitted: parsed.headers.get('auto-submitted')
  })

  return {
    ...summary,
    ...stream,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo?.trim() || undefined,
    references: toMessageIds(parsed.references),
    to: toMailAddresses(parsed.to),
    cc: toMailAddresses(parsed.cc),
    replyTo: toMailAddresses(parsed.replyTo),
    text: parsed.text,
    html: parsed.html || undefined,
    hasAttachment: parsed.attachments.length > 0
  }
}

/** mailparser gives one reference as a string, several as a list; the index wants a list */
function toMessageIds(references?: string[] | string): string[] | undefined {
  const list = (Array.isArray(references) ? references : references ? [references] : [])
    .map(reference => reference.trim())
    .filter(Boolean)

  return list.length ? list : undefined
}

function toSearchObject(search?: MailSearch): SearchObject | undefined {
  const criteria: SearchObject = {}

  if (search?.text) criteria.text = search.text
  if (search?.unread) criteria.seen = false
  if (search?.flagged) criteria.flagged = true
  if (search?.since) criteria.since = new Date(search.since)
  if (search?.before) criteria.before = new Date(search.before)
  if (search?.from) criteria.from = search.from
  // `hasAttachment` has no IMAP search criterion; the endpoint only offers it when the index serves the query

  return Object.keys(criteria).length ? criteria : undefined
}

export function createProtonMailProvider(values: SetupValues): MailProvider {
  const settings = toProtonSettings(values)

  // One mailbox connection and one ImapFlow command for a whole batch; the
  // single-uid methods delegate here so both paths share the same code.
  const setSeenMany: MailProvider['setSeenMany'] = (mailbox, uids, seen) => {
    if (!uids.length) {
      return Promise.resolve()
    }
    return withProtonMailbox(settings, mailbox, async (client) => {
      if (seen) {
        await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true })
      } else {
        await client.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true })
      }
    })
  }

  const moveMessages: MailProvider['moveMessages'] = (mailbox, uids, target) => {
    if (!uids.length) {
      return Promise.resolve(new Map<number, number>())
    }
    return withProtonMailbox(settings, mailbox, async (client) => {
      const result = await client.messageMove(uids.join(','), target, { uid: true })
      return new Map(result ? result.uidMap : undefined)
    })
  }

  const deleteMessages: MailProvider['deleteMessages'] = (mailbox, uids) => {
    if (!uids.length) {
      return Promise.resolve()
    }
    return withProtonMailbox(settings, mailbox, async (client) => {
      await client.messageDelete(uids.join(','), { uid: true })
    })
  }

  return {
    listMailboxes() {
      return withProtonBridge(settings, async (client) => {
        const list = await client.list({ statusQuery: { messages: true, unseen: true } })

        return list
          .filter(item => !item.flags.has('\\Noselect'))
          .map<Mailbox>(item => ({
            path: item.path,
            name: item.name,
            delimiter: item.delimiter,
            specialUse: protonSpecialUse(item.path, item.specialUse),
            label: isProtonLabel(item.path) || undefined,
            total: item.status?.messages ?? 0,
            unread: item.status?.unseen ?? 0
          }))
      })
    },

    listMessages(mailbox, { limit, offset = 0, search }) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const exists = client.mailbox ? client.mailbox.exists : 0
        if (!exists) {
          return []
        }

        const criteria = toSearchObject(search)
        let range: string
        let byUid = false

        if (criteria) {
          // Highest UIDs are the newest messages
          const uids = uidPage((await client.search(criteria, { uid: true })) || [], offset, limit)
          if (!uids.length) {
            return []
          }
          range = uids.join(',')
          byUid = true
        } else {
          // Newest messages have the highest sequence numbers
          const page = sequenceRange(exists, offset, limit)
          if (!page) {
            return []
          }
          range = `${page.start}:${page.end}`
        }

        const messages: MailSummary[] = []

        for await (const message of client.fetch(range, MESSAGE_QUERY, { uid: byUid })) {
          messages.push(toMailSummary(mailbox, message))
        }

        return messages.sort((a, b) => b.date.localeCompare(a.date))
      })
    },

    getMessage(mailbox, uid) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const message = await client.fetchOne(String(uid), { ...MESSAGE_QUERY, source: true }, { uid: true })

        return message && message.source ? toMailMessage(mailbox, message) : null
      })
    },

    getAttachments(mailbox, uid) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        // Attachments live in the source, so this fetches the whole message; the
        // list and index paths above cap the source, this one must not.
        const message = await client.fetchOne(String(uid), { ...MESSAGE_QUERY, source: true }, { uid: true })
        if (!message || !message.source) {
          return []
        }

        const parsed = await simpleParser(message.source)
        return parsed.attachments.map((attachment, index) => ({
          filename: attachmentFileName(attachment.filename, attachment.contentType, index),
          contentType: baseContentType(attachment.contentType),
          size: attachment.size ?? attachment.content.length,
          content: new Uint8Array(attachment.content)
        }))
      })
    },

    listMessageStates(mailbox) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const uidValidity = String(client.mailbox ? client.mailbox.uidValidity : '')
        const messages: MailMessageState[] = []

        if (client.mailbox && client.mailbox.exists) {
          for await (const message of client.fetch('1:*', { uid: true, flags: true })) {
            messages.push({ uid: message.uid, unread: !message.flags?.has('\\Seen'), flagged: !!message.flags?.has('\\Flagged') })
          }
        }

        return { uidValidity, messages }
      })
    },

    getMessages(mailbox, uids) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const messages: MailMessage[] = []
        if (!uids.length) {
          return messages
        }

        // The text parts come first; large attachments are cut off
        for await (const message of client.fetch(uids.join(','), { ...MESSAGE_QUERY, source: { maxLength: INDEX_SOURCE_BYTES } }, { uid: true })) {
          if (message.source) {
            messages.push(await toMailMessage(mailbox, message))
          }
        }

        return messages
      })
    },

    getStreamHeaders(mailbox, uids) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const headers: MailStreamHeader[] = []
        if (!uids.length) {
          return headers
        }

        // Only the four headers and the envelope, so the bodies stay on the server
        for await (const message of client.fetch(uids.join(','), { uid: true, envelope: true, headers: STREAM_HEADERS }, { uid: true })) {
          const from = toMailAddresses(message.envelope?.from)
          const values = parseRawStreamHeaders(message.headers?.toString('utf8') ?? '')
          headers.push({ uid: message.uid, from, ...mailStreamFlags(from, values) })
        }

        return headers
      })
    },

    setSeen(mailbox, uid, seen) {
      return setSeenMany(mailbox, [uid], seen)
    },

    setSeenMany,

    setFlagged(mailbox, uid, flagged) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        if (flagged) {
          await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
        } else {
          await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
        }
      })
    },

    moveMessage(mailbox, uid, target) {
      return moveMessages(mailbox, [uid], target).then(mapping => ({ uid: mapping.get(uid) }))
    },

    moveMessages,

    deleteMessage(mailbox, uid) {
      return deleteMessages(mailbox, [uid])
    },

    deleteMessages,

    addLabel(mailbox, uid, label) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        // Proton labels are IMAP folders under `Labels/`; copying keeps the mail in
        // its real folder, so the label only adds a second place it is filed under.
        const result = await client.messageCopy(String(uid), `Labels/${label}`, { uid: true })
        return { uid: result ? result.uidMap?.get(uid) : undefined }
      })
    },

    createMailbox(path) {
      return withProtonBridge(settings, async (client) => {
        try {
          await client.mailboxCreate(path)
        } catch (error) {
          // An existing folder is the common case and not an error
          if (!isMailboxExistsError(error)) {
            throw error
          }
        }
      })
    },

    send(mail, from) {
      return sendProtonMail(settings, mail, from)
    }
  }
}
