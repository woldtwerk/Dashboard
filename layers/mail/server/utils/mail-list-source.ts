/** Where the mail list of one request is served from */
export type MailListSource = 'index' | 'provider'

export interface MailListSourceQuery {
  /** The service has a search index at all */
  indexAvailable: boolean
  /** Every wanted folder finished its first full sync */
  indexed: boolean
  /** `scope=all`: the list spans the account's folders */
  allFolders: boolean
  /** A search narrows the list */
  hasCriteria: boolean
}

/**
 * The index answers the list whenever it exists and the wanted folders are
 * indexed — plain browsing included, so the result is ordered by date rather
 * than by the provider's sequence numbers. The provider only serves a folder
 * while its first full sync is still running.
 */
export function mailListSource({ indexAvailable, indexed }: MailListSourceQuery): MailListSource {
  return indexAvailable && indexed ? 'index' : 'provider'
}
