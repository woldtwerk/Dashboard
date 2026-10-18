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

export type DesktopPermissionStatus = 'default' | 'granted' | 'denied' | 'unsupported'

export interface DesktopPermissionView {
  status: DesktopPermissionStatus
  /** Short state text, shown next to "Permission:" */
  label: string
  /** Only the `default` state may ask the browser; the others must hide the button */
  showButton: boolean
  /** The `granted` state is shown as a success badge instead of plain text */
  showBadge: boolean
  /** Longer explanation for the states that need one */
  hint?: string
}

/** Maps the browser's permission state to what the settings card shows. */
export function desktopPermissionView(permission: NotificationPermissionState): DesktopPermissionView {
  switch (permission) {
    case 'granted':
      return { status: 'granted', label: 'Allowed', showButton: false, showBadge: true }
    case 'denied':
      return {
        status: 'denied',
        label: 'Blocked',
        showButton: false,
        showBadge: false,
        hint: 'Your browser will not ask again. Allow notifications for this site in the browser\'s site settings, then reload the page.'
      }
    case 'unsupported':
      return {
        status: 'unsupported',
        label: 'Not supported by this browser',
        showButton: false,
        showBadge: false,
        hint: 'This browser does not offer the Notification API, so desktop notifications cannot be used here.'
      }
    default:
      return { status: 'default', label: 'Not requested yet', showButton: true, showBadge: false }
  }
}
