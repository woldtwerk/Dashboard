/** A notification category contributed by a domain, e.g. `mail-new` */
export type NotificationCategory = string

/** How a category's notifications reach the user */
export type NotificationStyle = 'off' | 'in-app' | 'desktop' | 'both'

/** A notification as the client receives it */
export interface AppNotification {
  id: string
  category: NotificationCategory
  title: string
  body?: string
  /** In-app route the notification opens */
  to?: string
  domain: string
  service?: string
  /** ISO timestamp */
  at: string
  read: boolean
  /**
   * The style the server resolved when it sent the notification; only set on
   * live notifications, not on listed ones.
   */
  style?: NotificationStyle
}

/** A category as the settings UI shows it */
export interface NotificationCategoryInfo {
  id: NotificationCategory
  domain: string
  label: string
  description?: string
  defaultStyle: NotificationStyle
}
