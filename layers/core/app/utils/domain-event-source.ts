/** How long the connection stays open after its last subscriber leaves. */
export const DOMAIN_EVENT_GRACE_MS = 5000

export interface SourceLifecycleOptions {
  /** Connect when not connected; must be safe to call while already connected. */
  open: () => void
  /** Dispose the connection; must be safe to call while already closed. */
  close: () => void
  /** Ran after a lost connection is back, so callers can refetch what they missed. */
  onReconnect: () => void
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
  graceMs?: number
}

export interface SourceLifecycle {
  subscribe: () => void
  unsubscribe: () => void
  /** The connection failed; the next open is treated as a reconnect. */
  markErrored: () => void
  /** The connection opened. */
  markOpen: () => void
  /** The tab became visible again and the connection is gone; reopen and refetch. */
  reconnect: () => void
}

/**
 * Ref-counts subscribers and owns the connect/disconnect cycle: the source opens
 * with the first subscriber and closes `graceMs` after the last one leaves, so a
 * page navigation does not tear the connection down between two pages.
 */
export function createSourceLifecycle(options: SourceLifecycleOptions): SourceLifecycle {
  const graceMs = options.graceMs ?? DOMAIN_EVENT_GRACE_MS
  let subscribers = 0
  let isOpen = false
  let graceTimer: unknown
  let errored = false

  function cancelGrace() {
    if (graceTimer !== undefined) {
      options.clearTimer(graceTimer)
      graceTimer = undefined
    }
  }

  return {
    subscribe() {
      subscribers++
      cancelGrace()
      if (!isOpen) {
        isOpen = true
        options.open()
      }
    },
    unsubscribe() {
      subscribers = Math.max(0, subscribers - 1)
      if (subscribers > 0) {
        return
      }

      cancelGrace()
      graceTimer = options.setTimer(() => {
        graceTimer = undefined
        if (subscribers === 0) {
          isOpen = false
          options.close()
        }
      }, graceMs)
    },
    markErrored() {
      errored = true
    },
    markOpen() {
      isOpen = true
      if (errored) {
        errored = false
        options.onReconnect()
      }
    },
    reconnect() {
      cancelGrace()
      isOpen = true
      // The reconnect already refetches, so the following open must not repeat it
      errored = false
      options.open()
      options.onReconnect()
    }
  }
}
