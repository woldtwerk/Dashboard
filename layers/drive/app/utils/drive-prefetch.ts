/**
 * The prefetch policy for drive folders: a hover only counts after a short
 * intent delay, a press counts at once, only one listing is warmed at a time,
 * and navigating away drops everything that has not started yet. Kept free of
 * Vue so the policy can be tested on its own; the page supplies the loader.
 */

export interface DrivePrefetchTarget {
  service: string
  path: string
}

export const DRIVE_PREFETCH_HOVER_MS = 120

export interface DrivePrefetchQueue {
  /** Warms `target` after a short hover; a second hover before the delay is a no-op. */
  hover(target: DrivePrefetchTarget): void
  /** Drops a hover that has not reached the queue yet; an already queued load stays. */
  leave(target: DrivePrefetchTarget): void
  /** Queues `target` at once, e.g. on a pointer press or for a breadcrumb ancestor. */
  enqueue(target: DrivePrefetchTarget): void
  /** Drops every hover and every load that has not started; the running one is kept. */
  cancelQueued(): void
  /** Loads currently running (0 or 1). */
  readonly active: number
  /** Loads waiting for their turn. */
  readonly waiting: number
}

/** A folder across accounts; the service is part of the key because paths repeat. */
export function drivePrefetchKey(target: DrivePrefetchTarget): string {
  return `${target.service}\u0000${target.path}`
}

export function createDrivePrefetchQueue(
  load: (target: DrivePrefetchTarget) => unknown,
  options: { hoverMs?: number } = {}
): DrivePrefetchQueue {
  const hoverMs = options.hoverMs ?? DRIVE_PREFETCH_HOVER_MS
  const hoverTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const queued: { key: string, target: DrivePrefetchTarget }[] = []
  // Keys that are hovering, waiting or running, so a folder is only warmed once
  const known = new Set<string>()
  let running: string | undefined

  function pump() {
    if (running !== undefined) {
      return
    }

    const next = queued.shift()
    if (!next) {
      return
    }

    running = next.key
    void Promise.resolve()
      .then(() => load(next.target))
      .catch(() => {})
      .finally(() => {
        known.delete(next.key)
        running = undefined
        pump()
      })
  }

  function enqueue(key: string, target: DrivePrefetchTarget) {
    if (known.has(key)) {
      return
    }
    known.add(key)
    queued.push({ key, target })
    pump()
  }

  return {
    hover(target) {
      const key = drivePrefetchKey(target)
      if (known.has(key)) {
        return
      }
      // Marked pending while the intent delay runs, so repeat hovers are free
      known.add(key)
      hoverTimers.set(key, setTimeout(() => {
        hoverTimers.delete(key)
        queued.push({ key, target })
        pump()
      }, hoverMs))
    },

    leave(target) {
      const key = drivePrefetchKey(target)
      const timer = hoverTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        hoverTimers.delete(key)
        known.delete(key)
      }
    },

    enqueue(target) {
      const key = drivePrefetchKey(target)
      const timer = hoverTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        hoverTimers.delete(key)
        // A press promotes a still-hovering folder to a queued load
        known.delete(key)
      }
      enqueue(key, target)
    },

    cancelQueued() {
      for (const [key, timer] of hoverTimers) {
        clearTimeout(timer)
        known.delete(key)
      }
      hoverTimers.clear()
      for (const item of queued) {
        known.delete(item.key)
      }
      queued.length = 0
    },

    get active() {
      return running === undefined ? 0 : 1
    },

    get waiting() {
      return queued.length
    }
  }
}
