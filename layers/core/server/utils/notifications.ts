import { randomUUID } from 'node:crypto'
import { and, desc, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppNotification, NotificationCategoryInfo, NotificationStyle } from '../../shared/types/notifications'
import type { NotificationSettings } from '../../shared/types/settings'
import { notifications } from '../db/schema'
import { publishToChannel } from './domain-events'
import { getSettings } from './settings'
import { sendPush } from './web-push'

export type NotificationRow = typeof notifications.$inferSelect

/** Keep the bell useful without letting the table grow forever */
export const NOTIFICATION_RETENTION = 500

interface RegisteredCategory extends NotificationCategoryInfo {
  /** Registered for the API but not offered in the settings table */
  hidden?: boolean
}

const categories = new Map<string, RegisteredCategory>()

export const notificationStyleSchema = z.enum(['off', 'in-app', 'desktop', 'both'] as const)

export const notificationSettingsSchema = z.object({
  doNotDisturb: z.boolean(),
  categories: z.record(z.string(), notificationStyleSchema)
})

/** Registers a domain's category; call from a Nitro plugin. */
export function registerNotificationCategory(category: RegisteredCategory): void {
  categories.set(category.id, category)
}

export function getNotificationCategory(id: string): NotificationCategoryInfo | undefined {
  return categories.get(id)
}

/** Categories offered in the settings UI, in a stable order. Hidden ones stay out. */
export function listNotificationCategories(): NotificationCategoryInfo[] {
  return [...categories.values()]
    .filter(category => !category.hidden)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The defaults of the `notifications` section. Hidden categories are machinery,
 * not a user choice, so they are left out.
 */
export function notificationSettingsDefaults(): NotificationSettings {
  return {
    doNotDisturb: false,
    categories: Object.fromEntries(
      [...categories.values()]
        .filter(category => !category.hidden)
        .map(category => [category.id, category.defaultStyle])
    )
  }
}

/**
 * The user's style for a category, falling back to the category's registration.
 * A hidden category always keeps its registered style; it is not offered in the
 * settings, so whatever is stored for it is stale.
 */
export function notificationStyle(settings: NotificationSettings, category: string): NotificationStyle {
  const registered = categories.get(category)
  if (registered?.hidden) {
    return registered.defaultStyle
  }

  return settings.categories[category] ?? registered?.defaultStyle ?? 'in-app'
}

export interface NotificationInput {
  category: string
  title: string
  body?: string
  to?: string
  domain: string
  service?: string
  /** A repeated key means the notification was already sent; the insert is skipped */
  dedupeKey?: string
  /** Defaults to now */
  at?: Date
}

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed: notifications\.dedupe_key/i.test(String((error as { message?: string })?.message ?? error))
}

export function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body ?? undefined,
    to: row.to ?? undefined,
    domain: row.domain,
    service: row.service ?? undefined,
    at: row.at.toISOString(),
    read: !!row.readAt
  }
}

const appNotificationSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  title: z.string(),
  body: z.string().optional(),
  to: z.string().optional(),
  domain: z.string().min(1),
  service: z.string().optional(),
  at: z.iso.datetime(),
  read: z.boolean(),
  style: notificationStyleSchema.optional()
})

/** Parses one bus payload; malformed values are dropped rather than delivered. */
export function parseNotificationValue(value: unknown): AppNotification | undefined {
  const parsed = appNotificationSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export interface SseNotification {
  event: 'notification'
  data: string
}

export function formatSseNotification(notification: AppNotification): SseNotification {
  return { event: 'notification', data: JSON.stringify(notification) }
}

/**
 * Stores a notification and publishes it to every worker and browser. A style
 * of `off`, or a `dedupeKey` that was already stored, sends nothing.
 */
export async function notify(input: NotificationInput): Promise<AppNotification | undefined> {
  if (!categories.has(input.category)) {
    throw new Error(`Unknown notification category "${input.category}"`)
  }

  const settings = await getSettings<NotificationSettings>('notifications')
  const style = notificationStyle(settings, input.category)
  if (style === 'off') {
    return undefined
  }

  const db = await useDb()
  const now = new Date()
  const at = input.at ?? now
  let saved: NotificationRow | undefined

  try {
    saved = await db.transaction(async (tx) => {
      const [row] = await tx.insert(notifications).values({
        id: randomUUID(),
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        to: input.to ?? null,
        domain: input.domain,
        service: input.service ?? null,
        dedupeKey: input.dedupeKey ?? null,
        at,
        readAt: null
      }).returning()

      // Retention belongs to the same transaction, so the table never grows past the cap
      await tx.delete(notifications).where(sql`${notifications.id} NOT IN (
        SELECT id FROM notifications ORDER BY at DESC, id DESC LIMIT ${NOTIFICATION_RETENTION}
      )`)

      return row
    })
  } catch (error) {
    if (input.dedupeKey && isUniqueViolation(error)) {
      return undefined
    }
    throw error
  }

  if (!saved) {
    return undefined
  }

  const notification = toAppNotification(saved)
  const live = { ...notification, style }
  await publishToChannel('notifications', live)

  // Desktop-style categories also leave the dashboard as Web Push. notify() runs
  // once per event, so this is the one place that sends; the channel subscriber
  // only feeds open tabs. A push failure must not fail the caller.
  if (!settings.doNotDisturb && (style === 'desktop' || style === 'both')) {
    void sendPush(notification).catch((error) => {
      useServiceLogger('core', 'push').warn('Could not send push notifications', {
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }

  return live
}

export interface NotificationListQuery {
  limit: number
  /** ISO timestamp; only notifications older than this are returned */
  before?: string
}

export interface NotificationList {
  notifications: AppNotification[]
  unread: number
}

export async function unreadNotificationCount(): Promise<number> {
  const db = await useDb()
  const row = await db.select({ value: sql<number>`count(*)` }).from(notifications)
    .where(isNull(notifications.readAt))
    .get()

  return row?.value ?? 0
}

export async function listNotifications({ limit, before }: NotificationListQuery): Promise<NotificationList> {
  const db = await useDb()
  const rows = await db.select().from(notifications)
    .where(before ? lt(notifications.at, new Date(before)) : undefined)
    .orderBy(desc(notifications.at), desc(notifications.id))
    .limit(limit)

  return {
    notifications: rows.map(toAppNotification),
    unread: await unreadNotificationCount()
  }
}

/** Marks the given notifications read, or every unread one when no ids are given. */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const db = await useDb()
  const unread = isNull(notifications.readAt)

  await db.update(notifications)
    .set({ readAt: new Date() })
    .where(ids?.length ? and(unread, inArray(notifications.id, ids)) : unread)

  return unreadNotificationCount()
}
