/**
 * One place that answers "where does shared server state live".
 *
 * The Redis layer mounts a driver as `redis` when `NUXT_REDIS_URL` is set, so
 * every cluster worker reads the same bytes. Detection must match the mountpoint
 * unstorage actually records: `normalizeBaseKey` turns `redis` into `redis:`, so
 * a check for the bare `redis` is always false and silently fell back to Nitro's
 * per-worker memory storage.
 */

/** The mountpoint unstorage records for a driver mounted as `redis`. */
export const REDIS_MOUNTPOINT = 'redis:'

/**
 * One entry of `Storage.getMounts()`. The field carrying the mountpoint differs
 * between unstorage versions, so both are accepted.
 */
export interface StorageMount {
  base?: string
  mountpoint?: string
}

/** Whether any mount is the Redis storage, whatever field the version reports it in. */
export function hasRedisMount(mounts: StorageMount[]): boolean {
  return mounts.some((mount) => {
    const mountpoint = mount.base ?? mount.mountpoint ?? ''
    return mountpoint.replace(/:$/, '') === 'redis'
  })
}

/**
 * The storage shared by every cluster worker: Redis when it is mounted, else
 * Nitro's default in-process storage. Node-cluster safe either way — with Redis
 * the cache is genuinely shared; without it this degrades to the old per-worker
 * behaviour rather than breaking.
 */
export function sharedStorage() {
  const storage = useStorage()
  return hasRedisMount(storage.getMounts()) ? useStorage('redis') : storage
}
