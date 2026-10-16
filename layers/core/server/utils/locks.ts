import { acquireLock, isLocked, releaseLock, renewLock } from '../db/locks'
import type { Lock } from '../db/locks'

export interface LockHandle {
  /** Extend the lease; false when it was lost, so the work should stop */
  renew: () => Promise<boolean>
}

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

  try {
    return await fn({ renew: () => renewLock(db, lock, ttlMs) })
  } finally {
    await releaseLock(db, lock)
  }
}

export async function isLockHeld(name: string): Promise<boolean> {
  return isLocked(await useDb(), name)
}
