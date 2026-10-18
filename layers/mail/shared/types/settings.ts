/** Settings section `mail` */
export type MailListView = 'mails' | 'conversations'

export interface MailSettings {
  /** Addresses and `@domain` entries whose remote images load without asking */
  trustedImageSenders: string[]
  /** The view an unlinked visit starts in */
  listView: MailListView
}
