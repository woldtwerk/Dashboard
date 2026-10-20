import { and, count, eq, inArray, max } from 'drizzle-orm'
import { dashboardStorage } from '../../../core/server/utils/dashboard'
import { MAIL_SYNC_STALE_MS } from '../../shared/sync-schedule'
import type { Mailbox, MailIndexStatus, MailMessage } from '../../shared/types/mail'
import { mailIndexMailboxes, mailIndexMessages } from '../db/schema'
import { diffMailboxState } from '../mail-index/diff'
import { mailDocumentId, toMailDocument, type MailDocument } from '../mail-index/document'
import { labelsByMessageId } from '../mail-index/labels'
import { mailIndexStateIsCurrent, MAIL_INDEX_SCHEMA_VERSION } from '../mail-index/version'
import { labelFromMailbox } from '../../shared/mail-labels'
import { newMailNotification } from './mail-notifications'
import { backfillMailboxStreamKeys } from './mail-stream-backfill'
import type { MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

const LOCK_TTL_MS = 5 * 60_000
const FETCH_BATCH = 25
/** How long the status waits for a missing total before answering without one */
const TOTAL_LOOKUP_TIMEOUT_MS = 5_000
/** SQLite limits bound parameters per statement */
const SQL_CHUNK = 500
/** Virtual folders that only repeat messages of other folders */
const SKIPPED_SPECIAL_USE = new Set(['\\All', '\\Flagged'])

const lockName = (service: string) => `mail-sync:${service}`

/** Whether a folder only repeats mail stored elsewhere, so the sync does not index it */
export function isSkippedMailbox(mailbox: Pick<Mailbox, 'specialUse'>): boolean {
  return SKIPPED_SPECIAL_USE.has(mailbox.specialUse ?? '')
}

/** The folders the sync indexes; virtual folders are left to the folders they repeat */
export function syncMailboxes(mailboxes: Mailbox[]): Mailbox[] {
  return mailboxes.filter(mailbox => !isSkippedMailbox(mailbox))
}

/**
 * The folders a cross-folder search covers: real folders only. Labels and the
 * virtual folders repeat mail that a real folder already holds.
 */
export function searchableMailboxes(mailboxes: Mailbox[]): string[] {
  return mailboxes
    .filter(mailbox => !mailbox.label && !isSkippedMailbox(mailbox))
    .map(mailbox => mailbox.path)
}

/**
 * Indexed mailboxes the server no longer offers, or that are skipped now; the
 * sync drops their rows, so a folder that became virtual is forgotten too.
 */
export function forgottenMailboxes(known: string[], mailboxes: Mailbox[]): string[] {
  return known.filter(mailbox => !mailboxes.some(item => item.path === mailbox))
}

/** What the running sync is doing, shared with status requests through Nitro storage */
interface MailSyncProgress {
  /** Messages the provider reports for the folders this sync indexes */
  total: number
  /** Folder the sync is working on right now */
  mailbox?: string
  /** ISO time the run started */
  startedAt: string
}

const progressKey = (service: string) => `mail-sync-progress:${service}`

/** Progress is best effort: a storage failure must never fail a sync */
async function writeSyncProgress(
  service: string,
  progress: MailSyncProgress,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await dashboardStorage().setItem(progressKey(service), progress)
  } catch (error) {
    // Without the progress the status falls back to what the database holds
    onError?.(error)
  }
}

async function readSyncProgress(service: string): Promise<MailSyncProgress | undefined> {
  try {
    return await dashboardStorage().getItem<MailSyncProgress>(progressKey(service)) ?? undefined
  } catch {
    return undefined
  }
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

/** Just the part of the consola instance the mailbox sync needs */
interface SyncLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Brings the search index of one mail service up to date.
 * Runs on at most one cluster worker per service at a time.
 * @returns false when another worker is already syncing
 */
export async function syncMailService(service: string): Promise<boolean> {
  const index = useMailSearchIndex()
  if (!index) {
    return false
  }

  const startedAt = new Date()
  const logger = useServiceLogger('mail', service)
  let changed = 0
  let ran = false
  let ok = false
  let progress: MailSyncProgress | undefined

  // One warning per run: a broken storage is reported, not repeated for every batch
  let progressWriteFailed = false
  async function writeProgress(next: MailSyncProgress): Promise<void> {
    await writeSyncProgress(service, next, (error) => {
      if (progressWriteFailed) {
        return
      }
      progressWriteFailed = true
      logger.warn('Could not store sync progress', { error: errorMessage(error) })
    })
  }

  try {
    const result = await withLock(lockName(service), LOCK_TTL_MS, async ({ renew }) => {
      ran = true
      logger.info('Sync started')

      try {
        const provider = await useMailProvider(service)
        const db = await useDb()
        const mailboxes = syncMailboxes(await provider.listMailboxes())
        const newInbox: MailMessage[] = []

        // The folders' message counts give the status a total to measure against
        progress = { total: mailboxes.reduce((sum, mailbox) => sum + mailbox.total, 0), startedAt: startedAt.toISOString() }
        await writeProgress(progress)

        // Folders the server no longer offers, and the ones that became
        // virtual (Bridge's "All Mail"/"Starred"): drop their indexed rows
        const known = await db.select({ mailbox: mailIndexMailboxes.mailbox }).from(mailIndexMailboxes).where(eq(mailIndexMailboxes.service, service))
        for (const mailbox of forgottenMailboxes(known.map(row => row.mailbox), mailboxes)) {
          // A label folder that disappeared takes its label off the messages it repeated
          const messageIds = labelFromMailbox(mailbox) ? await mailboxMessageIds(service, mailbox, index) : []
          await index.removeMailbox(service, mailbox)
          changed += await forgetMailbox(service, mailbox)
          changed += await refreshMessageLabels(service, messageIds, index)
          await publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: mailbox })
        }

        for (const mailbox of mailboxes) {
          progress.mailbox = mailbox.path
          await writeProgress(progress)

          changed += await syncMailbox({
            service,
            mailbox,
            provider,
            index,
            renew,
            logger,
            onNewInbox: messages => newInbox.push(...messages)
          })
        }

        // Mail indexed before the stream keys existed is fixed up once per
        // mailbox, still under the sync lock, before the run is reported done
        changed += await backfillStreams({ service, provider, index, logger, renew })

        await notifyNewMail(service, newInbox)
        await publishDomainEvent({ domain: 'mail', service, type: 'synced' })
        ok = true
        return true
      } catch (error) {
        logger.error('Sync failed', { error: errorMessage(error) })
        throw error
      }
    })

    return result ?? false
  } finally {
    if (ran) {
      const durationMs = Date.now() - startedAt.getTime()
      logger.info('Sync finished', { durationMs, changed })
      await recordSyncRun({ domain: 'mail', service, startedAt: startedAt.toISOString(), durationMs, ok, changed })

      if (progress) {
        // The run is over: keep the total for the next status, drop the folder
        progress = { total: progress.total, startedAt: progress.startedAt }
        await writeProgress(progress)
      }
    }
  }
}

/** Sends one notification for the INBOX messages this run added; never fails the sync. */
async function notifyNewMail(service: string, messages: MailMessage[]): Promise<void> {
  const notification = newMailNotification(service, messages)
  if (!notification) {
    return
  }

  try {
    await notify(notification)
  } catch (error) {
    useServiceLogger('mail', service).warn('Could not send the new mail notification', { error: errorMessage(error) })
  }
}

/** Everything that can still name the messages a removed label mailbox held */
export interface RemovedLabelSources {
  /** SQL rows of the removed uids, with a Message-ID once one was stored */
  stored: { uid: number, messageId?: string | null }[]
  /** The index documents of those uids, when another worker did not remove them yet */
  documents: Pick<MailDocument, 'uid' | 'messageId'>[]
  /** Every document still carrying the label; the last resort when both above lost the message */
  documentsByLabel: () => Promise<Pick<MailDocument, 'messageId'>[]>
}

/**
 * The messages that lost the label copies of one label mailbox. Their stored
 * Message-ID survives the document; when an older row or a concurrent update
 * left none, the index is asked for every document still carrying the label, so
 * the real-folder copies can be repaired as well.
 */
export async function removedLabelMessageIds({ stored, documents, documentsByLabel }: RemovedLabelSources): Promise<string[]> {
  const messageIds = new Set<string>()
  for (const row of stored) {
    if (row.messageId) {
      messageIds.add(row.messageId)
    }
  }
  for (const document of documents) {
    messageIds.add(document.messageId)
  }

  // A row without a Message-ID whose document is gone has no other trace
  const knownUids = new Set(documents.map(document => document.uid))
  const missing = stored.some(row => !row.messageId && !knownUids.has(row.uid))
  if (stored.length && (!messageIds.size || missing)) {
    for (const document of await documentsByLabel()) {
      messageIds.add(document.messageId)
    }
  }

  return [...messageIds]
}

/** The `messageId`s of the messages indexed in one mailbox */
async function mailboxMessageIds(service: string, mailbox: string, index: MailSearchIndex): Promise<string[]> {
  const db = await useDb()
  const rows = await db.select({ uid: mailIndexMessages.uid, messageId: mailIndexMessages.messageId }).from(mailIndexMessages)
    .where(and(eq(mailIndexMessages.service, service), eq(mailIndexMessages.mailbox, mailbox)))

  const documents = rows.length
    ? await index.getDocuments(rows.map(row => mailDocumentId(service, mailbox, row.uid)))
    : []
  const messageIds = new Set(documents.map(document => document.messageId))
  for (const row of rows) {
    if (row.messageId) {
      messageIds.add(row.messageId)
    }
  }

  // A label mailbox forgotten after another worker already dropped its documents
  const label = labelFromMailbox(mailbox)
  if (!messageIds.size && label) {
    for (const document of await index.documentsByLabel(service, label)) {
      messageIds.add(document.messageId)
    }
  }

  return [...messageIds]
}

/**
 * Rewrites the `labels` of every indexed copy of the given messages from the
 * `Labels/` folders they still sit in. Called after a label copy appears or
 * disappears, so the mail's real-folder document follows its label immediately.
 */
async function refreshMessageLabels(service: string, messageIds: string[], index: MailSearchIndex): Promise<number> {
  const ids = [...new Set(messageIds)].filter(Boolean)
  if (!ids.length) {
    return 0
  }

  const documents = await index.documentsByMessageIds(service, ids)
  const labels = labelsByMessageId(documents)
  await index.updateDocuments(documents.map(document => ({
    id: document.id,
    labels: labels.get(document.messageId) ?? []
  })))

  return documents.length
}

/** Drops every indexed message of a mailbox; returns how many rows were removed. */
async function forgetMailbox(service: string, mailbox: string): Promise<number> {
  const db = await useDb()
  const row = await db.select({ count: count() }).from(mailIndexMessages)
    .where(and(eq(mailIndexMessages.service, service), eq(mailIndexMessages.mailbox, mailbox)))
    .get()

  await db.delete(mailIndexMessages).where(and(eq(mailIndexMessages.service, service), eq(mailIndexMessages.mailbox, mailbox)))
  await db.delete(mailIndexMailboxes).where(and(eq(mailIndexMailboxes.service, service), eq(mailIndexMailboxes.mailbox, mailbox)))

  return row?.count ?? 0
}

/**
 * The labels of the messages about to be indexed: the labels of their existing
 * copies, plus the folder's own label when a label mailbox is being indexed.
 */
async function labelsForMessages(
  service: string,
  mailbox: string,
  messages: MailMessage[],
  index: MailSearchIndex
): Promise<Map<number, string[]>> {
  const messageIds = messages.map(message => message.messageId).filter((id): id is string => !!id)
  const documents = messageIds.length ? await index.documentsByMessageIds(service, messageIds) : []
  const byMessage = labelsByMessageId(documents)
  const ownLabel = labelFromMailbox(mailbox)

  return new Map(messages.map((message) => {
    const labels = new Set(message.messageId ? byMessage.get(message.messageId) ?? [] : [])
    if (ownLabel) {
      labels.add(ownLabel)
    }
    return [message.uid, [...labels]]
  }))
}

async function syncMailbox({ service, mailbox, provider, index, renew, logger, onNewInbox }: {
  service: string
  mailbox: Mailbox
  provider: MailProvider
  index: MailSearchIndex
  renew: () => Promise<boolean>
  logger: SyncLogger
  onNewInbox: (messages: MailMessage[]) => void
}): Promise<number> {
  const db = await useDb()
  const path = mailbox.path
  const where = and(eq(mailIndexMailboxes.service, service), eq(mailIndexMailboxes.mailbox, path))
  const state = await provider.listMessageStates(path)
  let changed = 0

  let row = await db.select().from(mailIndexMailboxes).where(where).get()
  // Only a mailbox that was complete before this run can report "new" mail;
  // the first full sync would otherwise announce the whole inbox.
  const wasComplete = !!row?.complete && mailIndexStateIsCurrent(row, state.uidValidity)

  // A new UIDVALIDITY renumbers the mailbox, or an older schema version predates a document
  // field: either way the known UIDs/documents are void and the mailbox is rebuilt from scratch
  if (row && !mailIndexStateIsCurrent(row, state.uidValidity)) {
    await index.removeMailbox(service, path)
    changed += await forgetMailbox(service, path)
    row = undefined
  }
  if (!row) {
    await db.insert(mailIndexMailboxes).values({ service, mailbox: path, uidValidity: state.uidValidity, schemaVersion: MAIL_INDEX_SCHEMA_VERSION })
  }

  const messagesWhere = and(eq(mailIndexMessages.service, service), eq(mailIndexMessages.mailbox, path))
  const indexed = new Map((await db.select().from(mailIndexMessages).where(messagesWhere))
    .map(({ uid, unread, flagged }) => [uid, { unread, flagged }]))
  const diff = diffMailboxState(indexed, state.messages)

  // The message ids are read before the documents go, so a label that lost its
  // copy can be taken off the copy that stays in the real folder. The SQL row
  // keeps the Message-ID even after another worker already removed the document.
  const label = labelFromMailbox(path)
  const removedIds = diff.removed.map(uid => mailDocumentId(service, path, uid))
  let removedStored: { uid: number, messageId: string | null }[] = []
  if (label && diff.removed.length) {
    removedStored = await db.select({ uid: mailIndexMessages.uid, messageId: mailIndexMessages.messageId })
      .from(mailIndexMessages)
      .where(and(messagesWhere, inArray(mailIndexMessages.uid, diff.removed)))
  }
  const removedDocuments = label && removedIds.length ? await index.getDocuments(removedIds) : []
  const removedMessageIds = label && diff.removed.length
    ? await removedLabelMessageIds({
        stored: removedStored,
        documents: removedDocuments,
        documentsByLabel: () => index.documentsByLabel(service, label)
      })
    : []

  for (const uids of chunk(diff.removed, SQL_CHUNK)) {
    await index.remove(uids.map(uid => mailDocumentId(service, path, uid)))
    await db.delete(mailIndexMessages).where(and(messagesWhere, inArray(mailIndexMessages.uid, uids)))
  }

  if (removedMessageIds.length) {
    await refreshMessageLabels(service, removedMessageIds, index)
  }

  if (diff.changed.length) {
    await index.updateFlags(diff.changed.map(({ uid, unread, flagged }) => ({ id: mailDocumentId(service, path, uid), unread, flagged })))
    for (const { uid, unread, flagged } of diff.changed) {
      await db.update(mailIndexMessages).set({ unread, flagged }).where(and(messagesWhere, eq(mailIndexMessages.uid, uid)))
    }
  }

  for (const uids of chunk(diff.added, FETCH_BATCH)) {
    if (!await renew()) {
      logger.warn('Sync lock lost', { mailbox: path })
      throw new Error(`Lost sync lock for service ${service}`)
    }
    const messages = await provider.getMessages(path, uids)
    const labels = await labelsForMessages(service, path, messages, index)
    await index.upsert(messages.map(message => toMailDocument(service, path, message, labels.get(message.uid))))
    // Progress is kept per batch, so an interrupted sync continues where it stopped
    await db.insert(mailIndexMessages)
      .values(messages.map(({ uid, unread, flagged, messageId }) => ({ service, mailbox: path, uid, unread, flagged, messageId })))
      .onConflictDoNothing()

    // A new label copy puts its label on every other copy of the same message
    if (labelFromMailbox(path)) {
      await refreshMessageLabels(service, messages.map(message => message.messageId).filter((id): id is string => !!id), index)
    }

    if (wasComplete && path === 'INBOX') {
      onNewInbox(messages)
    }
  }

  await db.update(mailIndexMailboxes).set({ complete: true, syncedAt: new Date() }).where(where)

  changed += diff.removed.length + diff.changed.length + diff.added.length

  if (diff.removed.length || diff.changed.length || diff.added.length) {
    await publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: path })
  }

  return changed
}

/**
 * Backfills the stream keys of mail indexed before the stream keys existed.
 * One run per mailbox, tracked in `mail_index_mailboxes`, so an interrupted run
 * resumes at the next sync without a full re-index. Never fails the sync: a
 * mailbox that cannot be fetched is retried on the next run.
 */
async function backfillStreams({ service, provider, index, renew, logger }: {
  service: string
  provider: MailProvider
  index: MailSearchIndex
  renew: () => Promise<boolean>
  logger: SyncLogger
}): Promise<number> {
  const db = await useDb()
  const mailboxes = await db.select({ mailbox: mailIndexMailboxes.mailbox }).from(mailIndexMailboxes)
    .where(and(eq(mailIndexMailboxes.service, service), eq(mailIndexMailboxes.streamsBackfilled, 0)))

  let changed = 0

  for (const { mailbox } of mailboxes) {
    const uids = (await db.select({ uid: mailIndexMessages.uid }).from(mailIndexMessages)
      .where(and(eq(mailIndexMessages.service, service), eq(mailIndexMessages.mailbox, mailbox))))
      .map(row => row.uid)

    try {
      const result = await backfillMailboxStreamKeys({ service, mailbox, uids, provider, index, renew })
      changed += result.updated

      if (!result.complete) {
        logger.warn('Stream backfill lost the sync lock', { mailbox })
        break
      }

      await db.update(mailIndexMailboxes).set({ streamsBackfilled: 1 })
        .where(and(eq(mailIndexMailboxes.service, service), eq(mailIndexMailboxes.mailbox, mailbox)))
    } catch (error) {
      logger.warn('Stream backfill failed', { mailbox, error: errorMessage(error) })
    }
  }

  return changed
}

/** Whether the index of the service has not been synced within the stale window */
export function isMailSyncStale(syncedAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !syncedAt || now - syncedAt.getTime() > MAIL_SYNC_STALE_MS
}

/**
 * Syncs the index of the service when it is stale.
 * @returns false when it was fresh or another worker is already syncing
 */
export async function syncMailIfStale(service: string): Promise<boolean> {
  if (!useMailSearchIndex() || await isLockHeld(lockName(service))) {
    return false
  }

  const db = await useDb()
  const last = await db.select({ syncedAt: max(mailIndexMailboxes.syncedAt) }).from(mailIndexMailboxes)
    .where(eq(mailIndexMailboxes.service, service)).get()

  if (!isMailSyncStale(last?.syncedAt)) {
    return false
  }

  return syncMailService(service)
}

/** Starts a background sync when the index of the service is stale; never waits for it */
export async function requestMailSync(service: string) {
  syncMailIfStale(service).catch((error) => {
    useServiceLogger('mail', service).error('Background sync failed', { error: errorMessage(error) })
  })
}

/**
 * Whether search can be answered by the index: for one mailbox, for a list of
 * them (all have to be indexed and complete), or for every mailbox of the
 * service when omitted.
 */
export async function isMailboxIndexed(service: string, mailboxes?: string | string[]): Promise<boolean> {
  const list = typeof mailboxes === 'string' ? [mailboxes] : mailboxes
  if (list && !list.length) {
    return false
  }

  const db = await useDb()
  const rows = await db.select({ complete: mailIndexMailboxes.complete }).from(mailIndexMailboxes)
    .where(list ? and(eq(mailIndexMailboxes.service, service), inArray(mailIndexMailboxes.mailbox, list)) : eq(mailIndexMailboxes.service, service))

  // A requested mailbox with no row yet is not indexed, so every list entry needs its row
  return list
    ? rows.length === list.length && rows.every(row => row.complete)
    : rows.length > 0 && rows.every(row => row.complete)
}

/**
 * Resolves a promise, or rejects when it takes longer than `timeoutMs`.
 * The task keeps running; only the wait is given up.
 */
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Sum of the messages the provider reports for the folders the sync indexes */
export async function loadIndexTotal(service: string): Promise<number> {
  const provider = await useMailProvider(service)
  const mailboxes = syncMailboxes(await provider.listMailboxes())
  return mailboxes.reduce((sum, mailbox) => sum + mailbox.total, 0)
}

/**
 * The total the index status reports. A stored total wins; without one the
 * loader is asked, and a failure or a slow provider leaves the total unknown
 * rather than holding the status. The caller stores the result, so the provider
 * is not asked again for the next status.
 */
export async function resolveIndexTotal(
  stored: number | null | undefined,
  load: () => Promise<number>,
  timeoutMs: number = TOTAL_LOOKUP_TIMEOUT_MS
): Promise<number | null> {
  if (stored !== null && stored !== undefined) {
    return stored
  }

  try {
    return await withTimeout(load(), timeoutMs)
  } catch {
    return null
  }
}

export async function getMailIndexStatus(service: string): Promise<MailIndexStatus> {
  const db = await useDb()
  const [messages, indexed, mailboxes, syncing, progress] = await Promise.all([
    db.select({ count: count() }).from(mailIndexMessages).where(eq(mailIndexMessages.service, service)).get(),
    // Only folders with a sync state row count; the sync writes one per indexed folder
    db.select({ count: count() }).from(mailIndexMessages)
      .innerJoin(mailIndexMailboxes, and(eq(mailIndexMessages.service, mailIndexMailboxes.service), eq(mailIndexMessages.mailbox, mailIndexMailboxes.mailbox)))
      .where(eq(mailIndexMessages.service, service)).get(),
    db.select({ complete: mailIndexMailboxes.complete, syncedAt: mailIndexMailboxes.syncedAt }).from(mailIndexMailboxes).where(eq(mailIndexMailboxes.service, service)),
    isLockHeld(lockName(service)),
    readSyncProgress(service)
  ])
  const syncedAt = mailboxes.map(row => row.syncedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0)

  // A running sync that started before progress was stored leaves no total; ask
  // the provider once and keep the answer for the next status
  const total = await resolveIndexTotal(progress?.total, () => loadIndexTotal(service))
  if (total !== null && total !== progress?.total) {
    await writeSyncProgress(service, {
      total,
      mailbox: progress?.mailbox,
      startedAt: progress?.startedAt ?? new Date().toISOString()
    })
  }

  return {
    service,
    messages: messages?.count ?? 0,
    indexed: indexed?.count ?? 0,
    total,
    complete: mailboxes.length > 0 && mailboxes.every(row => row.complete),
    syncing,
    mailbox: syncing ? progress?.mailbox : undefined,
    syncedAt: syncedAt ? new Date(syncedAt).toISOString() : undefined
  }
}
