/**
 * A tiny concurrency limiter for thumbnail loads. The grid can hold hundreds of
 * tiles but the drive provider is slow and serialized, so only a couple of
 * images are fetched at a time; the rest wait until a slot frees.
 */

export interface ThumbnailSlot {
  /** Resolves with a release function once a slot is free; never resolves if cancelled first. */
  promise: Promise<() => void>
  /** Drops a request that has not started yet; a granted slot is released by the caller. */
  cancel(): void
}

export interface ThumbnailQueue {
  acquire(): ThumbnailSlot
}

interface Waiting {
  start: () => void
  cancelled: boolean
}

/** At most `limit` slots are held at a time, in the order they were requested. */
export function createThumbnailQueue(limit = 2): ThumbnailQueue {
  let active = 0
  const waiting: Waiting[] = []

  function pump() {
    while (active < limit && waiting.length) {
      const next = waiting.shift()!
      if (next.cancelled) {
        continue
      }
      active++
      next.start()
    }
  }

  return {
    acquire() {
      const entry: Waiting = { start: () => {}, cancelled: false }
      const promise = new Promise<() => void>((resolve) => {
        let released = false
        entry.start = () => {
          resolve(() => {
            if (released) {
              return
            }
            released = true
            active--
            pump()
          })
        }
      })

      waiting.push(entry)
      pump()

      return {
        promise,
        cancel: () => { entry.cancelled = true }
      }
    }
  }
}
