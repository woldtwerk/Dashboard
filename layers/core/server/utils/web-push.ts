import webpush from 'web-push'
import type { AppNotification } from '../../shared/types/notifications'
import { deleteSubscription, listSubscriptions } from '../db/push-subscription-repository'
import type { PushSubscriptionRow } from '../db/push-subscription-repository'
import { useServiceLogger } from './service-logger'

/** Browsers cap the visible body; keep the payload small and predictable. */
export const PUSH_BODY_MAX = 300

/** How many push services one notification is delivered to at a time. */
export const PUSH_CONCURRENCY = 5

export interface PushPayload {
  id: string
  title: string
  body?: string
  to?: string
  category: string
}

/**
 * A notification target may only be a path on this origin. Protocol-relative
 * URLs (`//evil.test`) would otherwise leave the dashboard when clicked.
 */
export function sameOriginPath(to: string | undefined): string | undefined {
  if (!to || !to.startsWith('/') || to.startsWith('//')) {
    return undefined
  }
  return to
}

/** The wire form of a notification; pure, so the sender and its test share one shape. */
export function toPushPayload(notification: AppNotification): PushPayload {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body?.slice(0, PUSH_BODY_MAX),
    to: sameOriginPath(notification.to),
    category: notification.category
  }
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return 'invalid endpoint'
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Runs `task` over every item with at most `limit` calls in flight. */
async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!
      await task(item)
    }
  })

  await Promise.all(workers)
}

async function deliver(subscription: PushSubscriptionRow, payload: string, vapidDetails: { subject: string, publicKey: string, privateKey: string }) {
  return await webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  }, payload, {
    TTL: 3600,
    urgency: 'normal',
    vapidDetails
  })
}

/**
 * Delivers one notification to every subscribed browser. Expired subscriptions
 * (404/410) are dropped; a failing push service never fails the notification
 * that caused it. The caller must not await this on the notify path.
 */
export async function sendPush(notification: AppNotification): Promise<void> {
  const { publicKey, privateKey, subject } = useRuntimeConfig().vapid
  if (!publicKey || !privateKey || !subject) {
    return
  }

  const db = await useDb()
  const subscriptions = await listSubscriptions(db)
  if (!subscriptions.length) {
    return
  }

  const payload = JSON.stringify(toPushPayload(notification))
  const vapidDetails = { subject, publicKey, privateKey }
  const logger = useServiceLogger('core', 'push')

  await forEachLimited(subscriptions, PUSH_CONCURRENCY, async (subscription) => {
    try {
      await deliver(subscription, payload, vapidDetails)
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode

      if (statusCode === 404 || statusCode === 410) {
        try {
          await deleteSubscription(db, subscription.endpoint)
        } catch (deleteError) {
          logger.warn('Could not remove an expired push subscription', {
            endpoint: endpointHost(subscription.endpoint),
            error: errorText(deleteError)
          })
        }
        return
      }

      // Only the host: keys and the full endpoint are credentials
      logger.warn('Could not deliver a push notification', {
        endpoint: endpointHost(subscription.endpoint),
        error: errorText(error)
      })
    }
  })
}
