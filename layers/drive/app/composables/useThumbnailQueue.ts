import { createThumbnailQueue } from '../utils/thumbnail-queue'
import type { ThumbnailQueue, ThumbnailSlot } from '../utils/thumbnail-queue'

/** At most two thumbnails are requested at a time, so the provider is never flooded. */
const THUMBNAIL_CONCURRENCY = 2

// A queue per tab is enough: it only throttles the images of this browser session
let queue: ThumbnailQueue | undefined

const serverSlot: ThumbnailSlot = {
  promise: new Promise<() => void>(() => {}),
  cancel: () => {}
}

/**
 * The shared thumbnail load limit for this tab. On the server it is a no-op, as
 * the server render only draws the icon and never fetches a thumbnail.
 */
export function useThumbnailQueue(): ThumbnailQueue {
  if (!import.meta.client) {
    return { acquire: () => serverSlot }
  }
  queue ??= createThumbnailQueue(THUMBNAIL_CONCURRENCY)
  return queue
}
