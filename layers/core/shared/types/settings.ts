import type { NotificationStyle } from './notifications'

/** Settings section `general` */
export interface GeneralSettings {
  /** IANA zone; null follows the browser */
  timeZone: string | null
}

/** Settings section `notifications` */
export interface NotificationSettings {
  doNotDisturb: boolean
  /** Style per category; a missing key falls back to the category's default */
  categories: Record<string, NotificationStyle>
}
