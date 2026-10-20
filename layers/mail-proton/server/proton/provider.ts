import type { FetchMessageObject, ImapFlow, SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { Readable } from 'node:stream'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { MailProvider } from '../../../mail/server/utils/mail-provider'
import type { Mailbox, MailMessage, MailMessageState, MailSearch, MailStreamHeader, MailSummary } from '../../../mail/shared/types/mail'
import { attachmentsFromStructure, contentIdsFromHtml, normalizeContentId, type MailPartStructure } from '../../../mail/shared/mail-attachments'
import { baseMimeType } from '../../../core/shared/mime'
import { mailStreamFlags, parseRawStreamHeaders } from '../../../mail/shared/mail-thread'
import { authenticationResultsFromRaw } from '../../../mail/shared/mail-auth'
import { labelMailbox } from '../../../mail/shared/mail-labels'
import { sequenceRange, uidPage } from './sequence'
import { isProtonLabel, protonSpecialUse } from './special-use'
import { toMailAddresses, toMailSummary, toProtonSettings, isMailboxExistsError, isMailboxNotFoundError, openProtonConnection, withProtonBridge, withProtonMailbox } from './bridge'
import { sendProtonMail } from './mailer'

const MESSAGE_QUERY = { uid: true, flags: true, envelope: true, internalDate: true } as const
const INDEX_SOURCE_BYTES = 256 * 1024
/** The only headers the stream backfill needs; the body is never fetched */
const STREAM_HEADERS = ['list-id', 'list-unsubscribe', 'precedence', 'auto-submitted']
/** The header a sender check reads; repeated values keep their order */
const AUTHENTICATION_HEADERS = ['authentication-results']

/** The first text/html body part, whose `cid:` references decide what is inline. */
function htmlPart(node: MailPartStructure): string | undefined {
  if (baseMimeType(node.type) === 'message/rfc822') {
    return undefined
  }
  if (baseMimeType(node.type) === 'text/html') {
    return node.part
  }
  for (const child of node.childNodes ?? []) {
    const part = htmlPart(child)
    if (part) {
      return part
    }
  }
  return undefined
}

/** Whether any part carries a Content-ID, i.e. whether the HTML can matter. */
function hasContentId(node: MailPartStructure): boolean {
  if (baseMimeType(node.type) === 'message/rfc822') {
    return false
  }
  if (node.id) {
    return true
  }
  return (node.childNodes ?? []).some(child => hasContentId(child))
}

async function downloadText(client: ImapFlow, uid: number, part: string): Promise<string | undefined> {
  const download = await client.download(String(uid), part, { uid: true })
  if (!download.content) {
    return undefined
  }
  return new Response(Readable.toWeb(download.content) as ReadableStream<Uint8Array>).text()
}

/**
 * The Content-IDs mailparser found in the body. It rewrites `cid:` to `data:`
 * in `html`, so `related`/`cid` is the reliable source for the parsed message.
 */
function referencedContentIds(attachments: Array<{ related?: boolean, cid?: string }>): Set<string> {
  const ids = new Set<string>()
  for (const attachment of attachments) {
    if (!attachment.related) {
      continue
    }
    const id = normalizeContentId(attachment.cid)
    if (id) {
      ids.add(id)
    }
  }
  return ids
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

  const attachments = attachmentsFromStructure(message.bodyStructure, referencedContentIds(parsed.attachments))

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
    attachments,
    // Inline images (signature logos, tracking pixels) belong to the body, not to the attachment list
    hasAttachment: attachments.some(attachment => !attachment.inline)
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

  const createMailbox: NonNullable<MailProvider['createMailbox']> = path => withProtonBridge(settings, async (client) => {
    try {
      await client.mailboxCreate(path)
    } catch (error) {
      // An existing folder is the common case and not an error
      if (!isMailboxExistsError(error)) {
        throw error
      }
    }
  })

  const addLabels: MailProvider['addLabels'] = async (mailbox, uids, label) => {
    if (!uids.length) {
      return new Map<number, number>()
    }

    const target = labelMailbox(label)
    // Already looking at the label folder: the mail is filed under it already
    if (mailbox === target) {
      return new Map<number, number>()
    }

    // Proton copies into an existing folder only; a first use creates it
    await createMailbox(target)

    return withProtonMailbox(settings, mailbox, async (client) => {
      const result = await client.messageCopy(uids.join(','), target, { uid: true })
      return new Map(result ? result.uidMap : undefined)
    })
  }

  const removeLabels: MailProvider['removeLabels'] = async (mailbox, uids, label) => {
    if (!uids.length) {
      return { removed: [], unresolved: [] }
    }

    const target = labelMailbox(label)
    // Already looking at the label folder: the copies are the uids themselves
    if (mailbox === target) {
      await deleteMessages(mailbox, uids)
      return { removed: uids, unresolved: [] }
    }

    return withProtonBridge(settings, async (client) => {
      const resolved: { uid: number, messageId: string }[] = []
      const unresolved: number[] = []
      const seen = new Set<number>()
      const source = await client.getMailboxLock(mailbox)
      try {
        for await (const message of client.fetch(uids.join(','), { uid: true, envelope: true }, { uid: true })) {
          seen.add(message.uid)
          const messageId = message.envelope?.messageId
          if (messageId) {
            resolved.push({ uid: message.uid, messageId })
          } else {
            unresolved.push(message.uid)
          }
        }
      } finally {
        source.release()
      }

      // A uid the fetch did not return was expunged or moved meanwhile
      for (const uid of uids) {
        if (!seen.has(uid)) {
          unresolved.push(uid)
        }
      }

      if (!resolved.length) {
        return { removed: [], unresolved }
      }

      let labelLock
      try {
        labelLock = await client.getMailboxLock(target)
      } catch (error) {
        // The label folder was never created or already emptied: nothing was removed
        if (isMailboxNotFoundError(error)) {
          return { removed: [], unresolved: [...unresolved, ...resolved.map(item => item.uid)] }
        }
        throw error
      }

      try {
        const found = new Set<number>()
        // Proton keeps one copy per message and label. Searching by Message-ID
        // also deletes the copy of a duplicate (a mail sent to oneself) in this
        // folder, which is the same message and therefore the intended one.
        for (const { uid, messageId } of resolved) {
          const matches = (await client.search({ header: { 'message-id': messageId } }, { uid: true })) || []
          if (!matches.length) {
            unresolved.push(uid)
            continue
          }
          for (const match of matches) {
            found.add(match)
          }
        }

        const removed = [...found]
        if (removed.length) {
          await client.messageDelete(removed.join(','), { uid: true })
        }
        return { removed, unresolved }
      } finally {
        labelLock.release()
      }
    })
  }

  /** The attachment metadata of one message, fetched without its body bytes. */
  const listAttachments: NonNullable<MailProvider['listAttachments']> = (mailbox, uid) => {
    return withProtonMailbox(settings, mailbox, async (client) => {
      const message = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true })
      if (!message || !message.bodyStructure) {
        return []
      }

      // A signature logo only says inline through the body's cid: reference, so
      // read the small HTML body part when the structure has any Content-ID.
      const part = hasContentId(message.bodyStructure) ? htmlPart(message.bodyStructure) : undefined
      const html = part ? await downloadText(client, uid, part) : undefined

      return attachmentsFromStructure(message.bodyStructure, contentIdsFromHtml(html))
    })
  }

  /**
   * Streams one attachment part. The connection is opened here, not by
   * withProtonMailbox: it has to stay (and keep the mailbox lock) until the
   * response stream ends, errors or is cancelled.
   *
   * N+1 Bridge logins: one part downloads on its own connection. A single
   * stream cannot be multiplexed safely across the provider's mailbox lock.
   */
  const openAttachment: NonNullable<MailProvider['openAttachment']> = async (mailbox, uid, part) => {
    const client = await openProtonConnection(settings)
    let lock: { release: () => void } | undefined
    let content: Readable | undefined
    let closed = false

    const close = async () => {
      if (closed) {
        return
      }
      closed = true
      // An unconsumed download must not keep the socket open while we log out
      content?.destroy()
      try {
        lock?.release()
      } catch {
        // The lock is gone either way; logging out still frees the connection
      } finally {
        await client.logout().catch(() => client.close())
      }
    }

    try {
      lock = await client.getMailboxLock(mailbox).catch((error) => {
        throw createError({ status: 404, statusText: `Mailbox "${mailbox}" not found`, cause: error })
      })

      const message = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true })
      if (!message || !message.bodyStructure) {
        await close()
        return null
      }

      // Only a part the same parser lists may be streamed, so a caller cannot
      // ask for an arbitrary body part (e.g. the HTML or a nested message).
      const meta = attachmentsFromStructure(message.bodyStructure).find(attachment => attachment.part === part)
      if (!meta) {
        await close()
        return null
      }

      const download = await client.download(String(uid), part, { uid: true })
      if (!download.content) {
        await close()
        return null
      }

      content = download.content
      // Releasing on every way a Node stream can end: end, error, or the close
      // emitted when Readable.toWeb's cancel() destroys it.
      const release = () => {
        void close()
      }
      download.content.once('end', release)
      download.content.once('error', release)
      download.content.once('close', release)

      return {
        meta,
        stream: Readable.toWeb(download.content) as ReadableStream<Uint8Array>,
        close,
        uidValidity: client.mailbox && client.mailbox.uidValidity ? String(client.mailbox.uidValidity) : undefined
      }
    } catch (error) {
      await close()
      throw error
    }
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
        const message = await client.fetchOne(String(uid), { ...MESSAGE_QUERY, bodyStructure: true, source: true }, { uid: true })

        return message && message.source ? toMailMessage(mailbox, message) : null
      })
    },

    listAttachments,

    openAttachment,

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
        for await (const message of client.fetch(uids.join(','), { ...MESSAGE_QUERY, bodyStructure: true, source: { maxLength: INDEX_SOURCE_BYTES } }, { uid: true })) {
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

    getAuthenticationResults(mailbox, uid) {
      return withProtonMailbox(settings, mailbox, async (client) => {
        const results: string[] = []

        // Headers only: a body is neither needed for the check nor fetched
        for await (const message of client.fetch(String(uid), { uid: true, headers: AUTHENTICATION_HEADERS }, { uid: true })) {
          results.push(...authenticationResultsFromRaw(message.headers?.toString('utf8') ?? ''))
        }

        return results
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
      return addLabels(mailbox, [uid], label).then(mapping => ({ uid: mapping.get(uid) }))
    },

    addLabels,

    removeLabels,

    createMailbox,

    send(mail, from) {
      return sendProtonMail(settings, mail, from)
    }
  }
}
