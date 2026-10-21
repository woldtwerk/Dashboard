import { createError } from 'nuxt/server'
import { entityKey, parseEntityKey } from '../../../core/shared/entities'
import type { MailAddress, MailMessage, MailSummary } from '../../../mail/shared/types/mail'
import { EMPTY_DOCUMENTS_FILTERS } from '../../../documents/shared/types/documents'
import type { DocumentsDocument } from '../../../documents/shared/types/documents'
import type { AutomationDomain, AutomationItem } from '../../shared/types/automation'
import { buildDocumentState, buildMailState } from '../../shared/automation'
import type { DraftItemContext } from '../../shared/workflow-draft'

/** The mailbox automation watches for new mail */
export const AUTOMATION_INBOX = 'INBOX'

/**
 * Narrows a batch of candidate keys to the items still to evaluate, so the caller
 * fetches the bodies of those only. The engine passes the seen/retry store in.
 */
export type DueKeys = (keys: string[]) => Promise<Set<string>>

/** Without a store asking (previews, sweeps), every listed item is a candidate */
const allDue: DueKeys = async keys => new Set(keys)

/** `Name <address>` lines, the form a decision reads */
export function formatAddresses(addresses: MailAddress[]): string {
  return addresses
    .map(address => address.name ? `${address.name} <${address.address ?? ''}>` : address.address ?? '')
    .filter(Boolean)
    .join(', ')
}

/**
 * The bare addresses of a sender line, the form the `from` condition tests, so a
 * condition built from one mail's sender (`from equals <address>`) still matches
 * the same sender when the display name changes.
 */
export function addressLine(addresses: MailAddress[]): string {
  return addresses
    .map(address => address.address || address.name || '')
    .filter(Boolean)
    .join(', ')
}

/**
 * The key a mail is evaluated under. The body fetch builds its items from the
 * message, the due prefilter from the summary: both go through here, so a
 * Message-ID missing on one side cannot make them disagree.
 */
export function mailItemKey(mailbox: string, uid: number, messageId?: string): string {
  return `${mailbox}|${uid}|${messageId ?? ''}`
}

function mailItem(service: string, mailbox: string, message: MailMessage): AutomationItem {
  const from = formatAddresses(message.from)

  return {
    domain: 'mail',
    service,
    key: mailItemKey(mailbox, message.uid, message.messageId),
    mailbox,
    uid: message.uid,
    messageId: message.messageId,
    unread: message.unread,
    flagged: message.flagged,
    fields: { from: addressLine(message.from), listId: message.listId ?? '', subject: message.subject, text: message.text ?? '' },
    state: buildMailState(from, message.subject, message.text ?? ''),
    title: message.subject || '(no subject)'
  }
}

function documentItem(service: string, document: DocumentsDocument, correspondentName?: string): AutomationItem {
  return {
    domain: 'documents',
    service,
    key: String(document.id),
    documentId: document.id,
    fields: {
      title: document.title,
      correspondent: correspondentName,
      text: document.content ?? ''
    },
    state: buildDocumentState(document.title, document.content ?? ''),
    title: document.title
  }
}

/** The entity key of an item, e.g. `mail:svc:INBOX/1` or `document:svc:42` */
export function itemRef(item: AutomationItem): string {
  if (item.domain === 'mail') {
    return entityKey({ type: 'mail', service: item.service, id: `${item.mailbox ?? AUTOMATION_INBOX}/${item.uid ?? 0}` })
  }
  return entityKey({ type: 'document', service: item.service, id: item.key })
}

/** Drops the items the engine would filter out anyway, before any body is fetched */
async function onlyDue(items: AutomationItem[], isDue: DueKeys): Promise<AutomationItem[]> {
  if (!items.length) {
    return []
  }
  const due = await isDue(items.map(item => item.key))
  return items.filter(item => due.has(item.key))
}

/** The newest summaries of a mailbox: the search index when mounted, else the provider */
async function listMailSummaries(service: string, limit: number, mailbox: string): Promise<MailSummary[]> {
  const index = useMailSearchIndex()
  if (index && mailbox === AUTOMATION_INBOX) {
    return await index.search({ services: [service], mailbox, search: {}, limit })
  }

  return await (await useMailProvider(service)).listMessages(mailbox, { limit })
}

/**
 * New mail to evaluate: the newest messages of a mailbox that are due, with their
 * bodies. `isDue` runs on the summaries first, so a mailbox where nothing is new
 * costs one listing and no body; the due ones come back in one `getMessages` call,
 * i.e. one Bridge connection, never one per message.
 */
export async function loadMailItems(
  service: string,
  limit: number,
  isDue: DueKeys = allDue,
  mailbox = AUTOMATION_INBOX
): Promise<AutomationItem[]> {
  const summaries = await listMailSummaries(service, limit, mailbox)
  const keyOf = (summary: MailSummary) => mailItemKey(mailbox, summary.uid, summary.messageId)
  const due = await isDue(summaries.map(keyOf))
  const uids = summaries.filter(summary => due.has(keyOf(summary))).map(summary => summary.uid)
  if (!uids.length) {
    return []
  }

  const messages = await (await useMailProvider(service)).getMessages(mailbox, uids)
  return messages.map(message => mailItem(service, mailbox, message))
}

/** Documents sitting in the archive's inbox, newest first, that are due */
export async function loadDocumentItems(service: string, limit: number, isDue: DueKeys = allDue): Promise<AutomationItem[]> {
  const provider = await useDocumentsProvider(service)
  const page = await provider.list({
    page: 1,
    pageSize: limit,
    sort: 'added',
    order: 'desc',
    filters: { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), inbox: true }
  })

  const correspondents = new Map((await provider.listCorrespondents()).map(entry => [entry.id, entry.name]))
  return await onlyDue(page.results.map(document => documentItem(
    service,
    document,
    document.correspondent !== null ? correspondents.get(document.correspondent) : undefined
  )), isDue)
}

/** The item loader the engine uses: the trigger's default source */
export function loadItems(domain: AutomationDomain, service: string, limit: number, isDue: DueKeys = allDue): Promise<AutomationItem[]> {
  return domain === 'mail' ? loadMailItems(service, limit, isDue) : loadDocumentItems(service, limit, isDue)
}

/**
 * The items a preview's "Last 50" shows: for mail the newest of the inbox, served
 * by the search index when one is mounted so it stays cheap; for documents the
 * newest of the archive. Nothing is filtered: a preview shows the newest items,
 * not only the ones a run would still evaluate.
 */
export async function loadRecentItems(domain: AutomationDomain, service: string, limit: number): Promise<AutomationItem[]> {
  if (domain === 'documents') {
    const provider = await useDocumentsProvider(service)
    const page = await provider.list({
      page: 1,
      pageSize: limit,
      sort: 'added',
      order: 'desc',
      filters: structuredClone(EMPTY_DOCUMENTS_FILTERS)
    })
    const correspondents = new Map((await provider.listCorrespondents()).map(entry => [entry.id, entry.name]))
    return page.results.map(document => documentItem(
      service,
      document,
      document.correspondent !== null ? correspondents.get(document.correspondent) : undefined
    ))
  }

  return await loadMailItems(service, limit)
}

/** One item addressed by an entity key, for the preview's "Pick an item" */export async function loadItemByRef(ref: string): Promise<AutomationItem> {
  const parsed = parseEntityKey(ref)
  const service = parsed?.service
  if (!parsed || !service) {
    throw createError({ status: 400, statusText: 'Invalid item reference' })
  }

  if (parsed.type === 'mail') {
    const at = parsed.id.lastIndexOf('/')
    const mailbox = at < 0 ? AUTOMATION_INBOX : parsed.id.slice(0, at)
    const uid = Number(parsed.id.slice(at + 1))
    if (!Number.isInteger(uid) || uid <= 0) {
      throw createError({ status: 400, statusText: 'Invalid mail reference' })
    }
    const message = await (await useMailProvider(service)).getMessage(mailbox, uid)
    if (!message) {
      throw createError({ status: 404, statusText: 'Mail not found' })
    }
    return mailItem(service, mailbox, message)
  }

  if (parsed.type === 'document') {
    const id = Number(parsed.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw createError({ status: 400, statusText: 'Invalid document reference' })
    }
    const provider = await useDocumentsProvider(service)
    const document = await provider.get(id)
    const correspondents = await provider.listCorrespondents()
    const name = document.correspondent !== null
      ? correspondents.find(entry => entry.id === document.correspondent)?.name
      : undefined
    return documentItem(service, document, name)
  }

  throw createError({ status: 400, statusText: 'The item reference is not a mail or document' })
}

// --- Draft from one item --------------------------------------------------

function nameFor(entries: Array<{ id: number, name: string }>, id: number | null | undefined): string | undefined {
  return id === null || id === undefined ? undefined : entries.find(entry => entry.id === id)?.name
}

/**
 * The item a "Create workflow…" action was opened with, in the shape
 * `draftFromItem` expects: a mail's sender line, subject and mailbox, or a
 * document's title and the names of its correspondent, type and tags. Read from
 * the same providers the run uses, so the draft matches the preview.
 */
export async function loadDraftItem(ref: string): Promise<DraftItemContext> {
  const parsed = parseEntityKey(ref)
  const service = parsed?.service
  if (!parsed || !service) {
    throw createError({ status: 400, statusText: 'Invalid item reference' })
  }

  if (parsed.type === 'mail') {
    const at = parsed.id.lastIndexOf('/')
    const mailbox = at < 0 ? AUTOMATION_INBOX : parsed.id.slice(0, at)
    const uid = Number(parsed.id.slice(at + 1))
    if (!Number.isInteger(uid) || uid <= 0) {
      throw createError({ status: 400, statusText: 'Invalid mail reference' })
    }
    const message = await (await useMailProvider(service)).getMessage(mailbox, uid)
    if (!message) {
      throw createError({ status: 404, statusText: 'Mail not found' })
    }
    return {
      domain: 'mail',
      ref,
      item: { from: message.from, to: message.to, subject: message.subject, mailbox, listId: message.listId, snippet: message.snippet }
    }
  }

  if (parsed.type === 'document') {
    const id = Number(parsed.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw createError({ status: 400, statusText: 'Invalid document reference' })
    }
    const provider = await useDocumentsProvider(service)
    const document = await provider.get(id)
    const [correspondents, documentTypes, tags] = await Promise.all([
      provider.listCorrespondents(),
      provider.listDocumentTypes(),
      provider.listTags()
    ])
    return {
      domain: 'documents',
      ref,
      item: {
        title: document.title,
        correspondent: nameFor(correspondents, document.correspondent),
        documentType: nameFor(documentTypes, document.documentType),
        tags: document.tags.map(tag => nameFor(tags, tag)).filter((name): name is string => !!name)
      }
    }
  }

  throw createError({ status: 400, statusText: 'The item reference is not a mail or document' })
}

// --- Safety-net sweep -----------------------------------------------------

export interface SweepItems {
  items: AutomationItem[]
  /** The newest timestamp among the listed items, or the old cursor when there was none */
  cursor: string | null
}

/** The newest of a set of ISO timestamps, or null when none parses */
export function maxTimestamp(values: string[]): string | null {
  let newest: number | null = null
  let value: string | null = null

  for (const candidate of values) {
    const ms = Date.parse(candidate)
    if (Number.isFinite(ms) && (newest === null || ms > newest)) {
      newest = ms
      value = candidate
    }
  }

  return value
}

/** Documents added after the cursor, newest first, for the sweep */
export async function loadDocumentsSince(service: string, since: string | null, limit: number): Promise<SweepItems> {
  const provider = await useDocumentsProvider(service)
  const documents = await provider.listAdded(since, limit)
  const correspondents = new Map((await provider.listCorrespondents()).map(entry => [entry.id, entry.name]))

  return {
    items: documents.map(document => documentItem(
      service,
      document,
      document.correspondent !== null ? correspondents.get(document.correspondent) : undefined
    )),
    cursor: maxTimestamp(documents.map(document => document.added)) ?? since
  }
}

/** Inbox mail newer than the cursor, for the sweep */
export async function loadMailSince(service: string, since: string | null, limit: number): Promise<SweepItems> {
  const summaries = await listMailSummaries(service, limit, AUTOMATION_INBOX)

  const sinceMs = since ? Date.parse(since) : Number.NaN
  const uids: number[] = []
  for (const summary of summaries) {
    const date = Date.parse(summary.date)
    if (!Number.isFinite(sinceMs) || date > sinceMs) {
      uids.push(summary.uid)
    }
  }

  const messages = uids.length ? await (await useMailProvider(service)).getMessages(AUTOMATION_INBOX, uids) : []
  return {
    items: messages.map(message => mailItem(service, AUTOMATION_INBOX, message)),
    cursor: maxTimestamp(summaries.map(summary => summary.date)) ?? since
  }
}
