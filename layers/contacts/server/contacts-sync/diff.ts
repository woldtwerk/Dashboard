import type { RemoteCard } from '../utils/contacts-provider'

/** One card as the cache has it: the object URL and its last etag. */
export interface CardRef {
  url: string
  etag?: string
}

export interface CardDiff {
  /** New cards and cards whose etag changed, with their data */
  upsert: RemoteCard[]
  /** Cards the server no longer lists */
  removed: string[]
}

/**
 * Compares the cached cards of an address book with the remote listing. A card
 * without an etag cannot be proven unchanged, so it is always upserted.
 */
export function diffCards(stored: CardRef[], remote: RemoteCard[]): CardDiff {
  const storedEtags = new Map(stored.map(card => [card.url, card.etag]))
  const remoteUrls = new Set(remote.map(card => card.url))

  return {
    upsert: remote.filter(card => !card.etag || storedEtags.get(card.url) !== card.etag),
    removed: stored.filter(card => !remoteUrls.has(card.url)).map(card => card.url)
  }
}
