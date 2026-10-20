/** The services a background sync runs over; just the identity the sync needs */
export interface StaleSyncService {
  id: string
}

/** Just the part of the consola instance a sync run needs */
export interface StaleSyncLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

export interface StaleSyncDeps {
  /** Services of the domain, e.g. from `listServices` */
  services: () => Promise<StaleSyncService[]>
  /** Syncs one service when its data is stale; false when it was fresh or the lock is held */
  syncIfStale: (service: string) => Promise<boolean>
  /** Logger of one service, so a failure names the account it belongs to */
  logger: (service: string) => StaleSyncLogger
}

export interface StaleSyncResult {
  /** Services this run synced */
  synced: number
  /** Services that were fresh, locked by another worker, or failed */
  skipped: number
}

/**
 * Syncs every service of a domain one after another. A failing service is logged
 * and counted as skipped; the remaining accounts still run. The per-service lock
 * in the sync itself makes this safe on every cluster worker.
 */
export async function syncStaleServices({ services, syncIfStale, logger }: StaleSyncDeps): Promise<StaleSyncResult> {
  let synced = 0
  let skipped = 0

  for (const service of await services()) {
    try {
      if (await syncIfStale(service.id)) {
        synced++
      } else {
        skipped++
      }
    } catch (error) {
      skipped++
      logger(service.id).warn('Background sync failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { synced, skipped }
}
