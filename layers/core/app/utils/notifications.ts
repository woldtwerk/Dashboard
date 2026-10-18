import type { AppNotification, NotificationStyle } from '#layers/core/shared/types/notifications'
import type { NotificationSettings } from '#layers/core/shared/types/settings'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export const NOTIFICATION_STYLE_ITEMS: { label: string, value: NotificationStyle }[] = [
  { label: 'Off', value: 'off' },
  { label: 'In app', value: 'in-app' },
  { label: 'Desktop', value: 'desktop' },
  { label: 'Both', value: 'both' }
]

const IN_APP: NotificationStyle = 'in-app'

export interface NotificationDelivery {
  toast: boolean
  desktop: boolean
}

/**
 * How one notification reaches the user. A style of `both` keeps the toast for
 * the visible tab; a hidden tab gets the desktop notification only, so the
 * same event is not announced twice when the user returns.
 */
export function deliveryFor(
  notification: AppNotification,
  settings: NotificationSettings,
  permission: NotificationPermissionState,
  visible: boolean
): NotificationDelivery {
  if (settings.doNotDisturb) {
    return { toast: false, desktop: false }
  }

  const style = settings.categories?.[notification.category] ?? IN_APP
  const desktop = (style === 'desktop' || style === 'both') && permission === 'granted'
  const toast = style === IN_APP || (style === 'both' && visible)

  return { toast, desktop }
}
