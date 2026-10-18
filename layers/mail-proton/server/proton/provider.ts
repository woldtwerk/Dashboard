import type { FetchMessageObject, SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { MailProvider } from '../../../mail/server/utils/mail-provider'
import type { Mailbox, MailMessage, MailMessageState, MailSearch, MailSummary } from '../../../mail/shared/types/mail'
import { toMailAddresses, toMailSummary, toProtonSettings, withProtonBridge, withProtonMailbox } from './bridge'

const MESSAGE_QUERY = { uid: true, flags: true, envelope: true, internalDate: true } as const
const INDEX_SOURCE_BYTES = 256 * 1024

async function toMailMessage(mailbox: string, message: FetchMessageObject): Promise<MailMessage> {
  const parsed = await simpleParser(message.source!)

  return {
    ...toMailSummary(mailbox, message),
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo?.trim() || undefined,
    references: toMessageIds(parsed.references),
    to: toMailAddresses(parsed.to),
    cc: toMailAddresses(parsed.cc),
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
            specialUse: item.specialUse,
            total: item.status?.messages ?? 0,
            unread: item.status?.unseen ?? 0
          }))
      })
    },

    listMessages(mailbox, { limit, search }) {
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
          const uids = (await client.search(criteria, { uid: true })) || []
          if (!uids.length) {
            return []
          }
          range = uids.sort((a, b) => a - b).slice(-limit).join(',')
          byUid = true
        } else {
          // Newest messages have the highest sequence numbers
          range = `${Math.max(1, exists - limit + 1)}:*`
        }

        const messages: MailSummary[] = []

        for await (const message of client.fetch(range, { uid: true, flags: true, envelope: true, internalDate: true }, { uid: byUid })) {
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
        await client.messageMove(String(uid), target, { uid: true })
      })
    }
  }
}
