/** Settings section `mail` */
export type MailListView = 'mails' | 'conversations'

export interface MailSettings {
  /** Addresses and `@domain` entries whose remote images load without asking */
  trustedImageSenders: string[]
  /** The view an unlinked visit starts in */
  listView: MailListView
  /**
   * Extra From addresses per account, keyed by service id. IMAP does not list a
   * Proton account's aliases, so an alias that was never sent from is added here.
   */
  senderAddresses: Record<string, string[]>
  /** The label that marks a mail as done; `e` adds it and marks the mail read */
  doneLabel: string
}
