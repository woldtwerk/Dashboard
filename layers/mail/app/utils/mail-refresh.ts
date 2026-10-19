export interface MailRefreshState {
  /** A sync of the current service runs on the server */
  syncing: boolean
  /** The index of the current service is still being built */
  indexing: boolean
  /** Messages indexed so far, for the progress in the text */
  messages: number
  /** The list on screen is reloading */
  reloading: boolean
}

/**
 * The tooltip of the refresh button, naming whichever activity is running.
 * A running sync wins over the standing build state: it is what was just asked
 * for, and the progress bars below the toolbar already show the build.
 */
export function mailRefreshTooltip({ syncing, indexing, messages, reloading }: MailRefreshState): string {
  if (syncing) {
    return 'Syncing with the mail server…'
  }
  if (indexing) {
    return `Building search index (${messages} messages). Until then, search goes to the mail server.`
  }
  if (reloading) {
    return 'Refreshing…'
  }
  return 'Refresh'
}
