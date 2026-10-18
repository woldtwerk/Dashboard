import { and, count, eq, inArray, max } from 'drizzle-orm'
import type { Mailbox, MailMessage } from '../../shared/types/mail'
import { mailIndexMailboxes, mailIndexMessages } from '../db/schema'
import { diffMailboxState } from '../mail-index/diff'
import { mailDocumentId, toMailDocument } from '../mail-index/document'
import { mailIndexStateIsCurrent, MAIL_INDEX_SCHEMA_VERSION } from '../mail-index/version'
import { newMailNotification } from './mail-notifications'
import type { MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

const LOCK_TTL_MS = 5 * 60_000
const STALE_MS = 2 * 60_000
const FETCH_BATCH = 25
/** SQLite limits bound parameters per statement */
const SQL_CHUNK = 500
/** Virtual folders that only repeat messages of other folders */
const SKIPPED_SPECIAL_USE = new Set(['\\All', '\\Flagged'])

const lockName = (service: string) => `mail-sync:${service}`

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

  try {
    const result = await withLock(lockName(service), LOCK_TTL_MS, async ({ renew }) => {
      ran = true
      logger.info('Sync started')

      try {
        const provider = await useMailProvider(service)
        const db = await useDb()
        const mailboxes = (await provider.listMailboxes()).filter(mailbox => !SKIPPED_SPECIAL_USE.has(mailbox.specialUse ?? ''))
        const newInbox: MailMessage[] = []

        // Folders deleted on the server
        const known = await db.select({ mailbox: mailIndexMailboxes.mailbox }).from(mailIndexMailboxes).where(eq(mailIndexMailboxes.service, service))
        for (const { mailbox } of known.filter(row => !mailboxes.some(item => item.path === row.mailbox))) {
          await index.removeMailbox(service, mailbox)
          changed += await forgetMailbox(service, mailbox)
          await publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: mailbox })
        }

        for (const mailbox of mailboxes) {
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

  for (const uids of chunk(diff.removed, SQL_CHUNK)) {
    await index.remove(uids.map(uid => mailDocumentId(service, path, uid)))
    await db.delete(mailIndexMessages).where(and(messagesWhere, inArray(mailIndexMessages.uid, uids)))
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
    await index.upsert(messages.map(message => toMailDocument(service, path, message)))
    // Progress is kept per batch, so an interrupted sync continues where it stopped
    await db.insert(mailIndexMessages)
      .values(messages.map(({ uid, unread, flagged }) => ({ service, mailbox: path, uid, unread, flagged })))
      .onConflictDoNothing()

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

/** Starts a background sync when the index of the service is stale; never waits for it */
export async function requestMailSync(service: string) {
  if (!useMailSearchIndex() || await isLockHeld(lockName(service))) {
    return
  }

  const db = await useDb()
  const last = await db.select({ syncedAt: max(mailIndexMailboxes.syncedAt) }).from(mailIndexMailboxes)
    .where(eq(mailIndexMailboxes.service, service)).get()

  if (!last?.syncedAt || Date.now() - last.syncedAt.getTime() > STALE_MS) {
    syncMailService(service).catch((error) => {
      useServiceLogger('mail', service).error('Background sync failed', { error: errorMessage(error) })
    })
  }
}

/** Whether search for this mailbox can be answered by the index */
export async function isMailboxIndexed(service: string, mailbox?: string): Promise<boolean> {
  const db = await useDb()
  const rows = await db.select({ complete: mailIndexMailboxes.complete }).from(mailIndexMailboxes)
    .where(mailbox ? and(eq(mailIndexMailboxes.service, service), eq(mailIndexMailboxes.mailbox, mailbox)) : eq(mailIndexMailboxes.service, service))

  return rows.length > 0 && rows.every(row => row.complete)
}

export interface MailIndexStatus {
  service: string
  messages: number
  complete: boolean
  syncing: boolean
  syncedAt?: string
}

export async function getMailIndexStatus(service: string): Promise<MailIndexStatus> {
  const db = await useDb()
  const [messages, mailboxes, syncing] = await Promise.all([
    db.select({ count: count() }).from(mailIndexMessages).where(eq(mailIndexMessages.service, service)).get(),
    db.select({ complete: mailIndexMailboxes.complete, syncedAt: mailIndexMailboxes.syncedAt }).from(mailIndexMailboxes).where(eq(mailIndexMailboxes.service, service)),
    isLockHeld(lockName(service))
  ])
  const syncedAt = mailboxes.map(row => row.syncedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0)

  return {
    service,
    messages: messages?.count ?? 0,
    complete: mailboxes.length > 0 && mailboxes.every(row => row.complete),
    syncing,
    syncedAt: syncedAt ? new Date(syncedAt).toISOString() : undefined
  }
}
