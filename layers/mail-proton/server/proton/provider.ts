import type { FetchMessageObject, SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { MailProvider } from '../../../mail/server/utils/mail-provider'
import type { Mailbox, MailMessage, MailMessageState, MailSearch, MailStreamHeader, MailSummary } from '../../../mail/shared/types/mail'
import { mailStreamFlags, parseRawStreamHeaders } from '../../../mail/shared/mail-thread'
import { sequenceRange, uidPage } from './sequence'
import { isProtonLabel, protonSpecialUse } from './special-use'
import { toMailAddresses, toMailSummary, toProtonSettings, withProtonBridge, withProtonMailbox } from './bridge'
import { sendProtonMail } from './mailer'

const MESSAGE_QUERY = { uid: true, flags: true, envelope: true, internalDate: true } as const
const INDEX_SOURCE_BYTES = 256 * 1024
/** The only headers the stream backfill needs; the body is never fetched */
const STREAM_HEADERS = ['list-id', 'list-unsubscribe', 'precedence', 'auto-submitted']

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
      return withProtonMailbox(settings, mailbox, async (client) => {
        if (seen) {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
        }
      })
    },

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
      return withProtonMailbox(settings, mailbox, async (client) => {
        const result = await client.messageMove(String(uid), target, { uid: true })
        return { uid: result ? result.uidMap?.get(uid) : undefined }
      })
    },

    deleteMessage(mailbox, uid) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        await client.messageDelete(String(uid), { uid: true })
      })
    },

    send(mail, from) {
      return sendProtonMail(settings, mail, from)
    }
  }
}
