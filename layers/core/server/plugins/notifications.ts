import { z } from 'zod'
import type { DomainEvent } from '../../shared/types/domain-events'
import { syncFailedNotification } from '../utils/notification-events'
import { notificationSettingsDefaults, notificationSettingsSchema, registerNotificationCategory } from '../utils/notifications'
import { registerSettings } from '../utils/settings'

const generalSettingsSchema = z.object({
  timeZone: z.string().min(1).nullable()
})

const generalSettingsDefaults = { timeZone: 'Europe/Berlin' }

/** Core's own categories and settings; domains register theirs in their own plugins. */
export default defineNitroPlugin(() => {
  registerNotificationCategory({
    id: 'sync-failed',
    domain: 'core',
    label: 'Sync failures',
    description: 'A service could not finish syncing.',
    defaultStyle: 'in-app'
  })

  // Used by the "Send test notification" button; machinery, not a user choice
  registerNotificationCategory({
    id: 'test',
    domain: 'core',
    label: 'Test notification',
    description: 'Sent from the notifications settings.',
    defaultStyle: 'both',
    hidden: true
  })

  registerSettings('general', generalSettingsSchema, generalSettingsDefaults)
  registerSettings('notifications', notificationSettingsSchema, notificationSettingsDefaults)

  useDomainEventBus().subscribe((event) => {
    if (event.type === 'sync-failed') {
      void notifySyncFailed(event)
    }
  })
})

async function notifySyncFailed(event: DomainEvent): Promise<void> {
  try {
    const service = await getService(event.service).catch(() => undefined)
    await notify(syncFailedNotification(event, service?.name ?? event.service))
  } catch (error) {
    // A notification must never fail the sync that caused it
    console.error('[notifications] Could not send a sync failure:', error)
  }
}
