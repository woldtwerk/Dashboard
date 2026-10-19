import { acquireLock, isLocked, releaseLock, renewLock } from '../db/locks'
import type { Lock } from '../db/locks'

export interface LockHandle {
  /** Extend the lease; false when it was lost, so the work should stop */
  renew: () => Promise<boolean>
}

// The leases this worker currently holds. It is this worker's own bookkeeping,
// not shared state: under node_cluster every worker tracks only its own leases
// and releases them when it shuts down. A lease left behind then stays until
// its TTL runs out, which would report a sync as running long after the worker
// that ran it is gone.
const heldLocks = new Set<Lock>()

/**
 * Runs `fn` while holding the named lease, on at most one worker at a time.
 * @returns the result, or `undefined` when another worker holds the lease
 */
export async function withLock<T>(name: string, ttlMs: number, fn: (handle: LockHandle) => Promise<T>): Promise<T | undefined> {
  const db = await useDb()
  const lock: Lock | undefined = await acquireLock(db, name, ttlMs)
  if (!lock) {
    return undefined
  }

  heldLocks.add(lock)
  try {
    return await fn({ renew: () => renewLock(db, lock, ttlMs) })
  } finally {
    await releaseLock(db, lock)
    heldLocks.delete(lock)
  }
}

/**
 * Releases every lease this worker still holds, so a shutdown (dev reload,
 * graceful restart, deploy) does not leave them behind until their TTL.
 * Errors are swallowed per lease: one failed release must not keep the rest
 * alive. `releaseLock` only deletes rows whose owner matches, so a lease
 * already taken over by another worker is never dropped.
 */
export async function releaseHeldLocks(): Promise<void> {
  if (!heldLocks.size) {
    return
  }

  const db = await useDb()
  for (const lock of heldLocks) {
    try {
      await releaseLock(db, lock)
    } catch (error) {
      console.warn(`[locks] Could not release ${lock.name} on shutdown`, error)
    }
  }
  heldLocks.clear()
}

export async function isLockHeld(name: string): Promise<boolean> {
  return isLocked(await useDb(), name)
}
