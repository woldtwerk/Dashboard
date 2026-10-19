import type {
  DashboardMetric,
  DashboardSeries,
  DashboardSeriesInfo,
  ServiceStatus
} from '../../shared/types/dashboard'
import type { ServiceInfo } from '../../shared/types/setup'
import { useServiceLogger } from './service-logger'
import { sharedStorage } from './shared-storage'

export interface DashboardSeriesSource {
  info: Omit<DashboardSeriesInfo, 'id' | 'domain'>
  points(days: number): Promise<DashboardSeries['points']>
}

export interface DashboardSource {
  /** Health of one configured service of the domain */
  status?(service: ServiceInfo): Promise<Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'>>
  metrics?(): Promise<DashboardMetric[]>
  series?: Record<string, DashboardSeriesSource>
}

const sources = new Map<string, DashboardSource>()

/** Called by a domain layer's Nitro plugin; the core knows nothing domain-specific */
export function registerDashboardSource(domain: string, source: DashboardSource) {
  sources.set(domain, source)
}

export function getDashboardSource(domain: string): DashboardSource | undefined {
  return sources.get(domain)
}

/** Test hook; a server registers its sources once at startup */
export function resetDashboardSources() {
  sources.clear()
}

const METRICS_TTL_SECONDS = 2 * 60
const SERIES_TTL_SECONDS = 10 * 60

export const SERVICE_STATUS_TIMEOUT_MS = 3_000

/** A broken service may log its failing health check once per this interval. */
export const STATUS_LOG_INTERVAL_MS = 5 * 60_000

// Redis when mounted (shared by every cluster worker), else the default Nitro storage
export function dashboardStorage() {
  return sharedStorage()
}

async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    return await dashboardStorage().getItem<T>(key) ?? undefined
  } catch {
    // The dashboard still works without its cache
    return undefined
  }
}

async function writeCache(key: string, value: null | string | number | boolean | object, ttl: number): Promise<void> {
  try {
    await dashboardStorage().setItem(key, value, { ttl })
  } catch {
    // Best effort: a cache write never makes a request fail
  }
}

const metricsKey = (domain: string) => `dashboard:metrics:${domain}`
const seriesKey = (domain: string, id: string, days: number) => `dashboard:series:${domain}:${id}:${days}`
const seriesPrefix = (domain: string) => `dashboard:series:${domain}:`

/**
 * Drops the cached metrics and every cached series of a domain. Called when a
 * `changed` or `synced` domain event arrives, so the next request does not
 * serve a value cached up to two minutes ago.
 */
export async function invalidateDashboardDomain(domain: string): Promise<void> {
  try {
    const storage = dashboardStorage()
    await storage.removeItem(metricsKey(domain))

    const keys = await storage.getKeys(seriesPrefix(domain))
    await Promise.all(keys.map(key => storage.removeItem(key)))
  } catch (error) {
    console.warn(`[dashboard] Could not invalidate the cache of "${domain}":`, error)
  }
}

/** Every metric of every registered source; a failing source is skipped and warned about */
export async function listDashboardMetrics(): Promise<DashboardMetric[]> {
  const results = await Promise.all([...sources].map(async ([domain, source]): Promise<DashboardMetric[]> => {
    if (!source.metrics) {
      return []
    }

    const key = metricsKey(domain)
    const cached = await readCache<DashboardMetric[]>(key)
    if (cached) {
      return cached
    }

    try {
      const metrics = await source.metrics()
      await writeCache(key, metrics, METRICS_TTL_SECONDS)
      return metrics
    } catch (error) {
      console.warn(`[dashboard] Metrics of "${domain}" are unavailable:`, error)
      return []
    }
  }))

  return results.flat()
}

/** Metadata of every series, without their points */
export function listDashboardSeries(): DashboardSeriesInfo[] {
  return [...sources].flatMap(([domain, source]) => Object.entries(source.series ?? {})
    .map(([id, series]) => ({ id, domain, ...series.info })))
}

interface FoundSeries {
  domain: string
  series: DashboardSeriesSource
}

function findSeries(id: string): FoundSeries | undefined {
  for (const [domain, source] of sources) {
    const series = source.series?.[id]
    if (series) {
      return { domain, series }
    }
  }
  return undefined
}

/** One series with one point per bucket; undefined for an unknown id */
export async function getDashboardSeries(id: string, days: number): Promise<DashboardSeries | undefined> {
  const found = findSeries(id)
  if (!found) {
    return undefined
  }

  const { domain, series } = found
  const key = seriesKey(domain, id, days)
  const cached = await readCache<DashboardSeries['points']>(key)

  if (cached) {
    return { id, domain, ...series.info, points: cached }
  }

  try {
    const points = await series.points(days)
    await writeCache(key, points, SERIES_TTL_SECONDS)
    return { id, domain, ...series.info, points }
  } catch (error) {
    console.warn(`[dashboard] Series "${id}" of "${domain}" is unavailable:`, error)
    return { id, domain, ...series.info, points: [] }
  }
}

/** Resolves with the promise's value, or rejects after `ms` */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether a failure may be logged again, given when it was last logged. */
export function shouldLogAgain(lastAt: number | null | undefined, now: number, intervalMs: number): boolean {
  return lastAt == null || now - lastAt >= intervalMs
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Logs a failing health check at most once per interval and service. The last
 * time lives in the shared Nitro storage, so every cluster worker agrees.
 */
async function logStatusFailure(service: ServiceInfo, error: string): Promise<void> {
  try {
    const key = `dashboard:status-log:${service.id}`
    const now = Date.now()
    const lastAt = await readCache<number>(key)

    if (!shouldLogAgain(lastAt, now, STATUS_LOG_INTERVAL_MS)) {
      return
    }

    await writeCache(key, now, STATUS_LOG_INTERVAL_MS / 1_000)
    useServiceLogger(service.domain, service.id).warn('Health check failed', { error })
  } catch {
    // Logging a health check must never break the services endpoint
  }
}

/** One service with the health its domain reports; unknown without a source or after a timeout */
export async function dashboardServiceStatus(service: ServiceInfo, timeoutMs = SERVICE_STATUS_TIMEOUT_MS): Promise<ServiceStatus> {
  const source = sources.get(service.domain)
  let status: Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'> = { health: 'unknown', syncedAt: null }

  if (source?.status) {
    try {
      status = await withTimeout(source.status(service), timeoutMs)

      if (status.health === 'error') {
        await logStatusFailure(service, status.error ?? 'The service reported an error')
      }
    } catch (error) {
      status = { health: 'unknown', syncedAt: null }
      await logStatusFailure(service, errorText(error))
    }
  }

  return {
    id: service.id,
    name: service.name,
    domain: service.domain,
    icon: service.icon,
    ...status
  }
}

// --- Buckets --------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const dateOfKey = (key: string) => new Date(`${key}T00:00:00.000Z`)

/** UTC midnight of a date */
function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** The Monday of the week a date falls in, as UTC midnight */
export function weekStart(date: Date): Date {
  const start = dayStart(date)
  const weekday = (start.getUTCDay() + 6) % 7
  return new Date(start.getTime() - weekday * DAY_MS)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/**
 * One point per day, or per week (Monday start), oldest first, ending today.
 * Missing buckets are 0; duplicate input dates are summed.
 *
 * `days` is the requested span, so a weekly result has one point for each
 * week that overlaps it.
 */
export function fillBuckets(
  points: DashboardSeries['points'],
  days: number,
  bucket: DashboardSeriesInfo['bucket'],
  today = new Date()
): DashboardSeries['points'] {
  const end = dayStart(today)

  if (bucket === 'day') {
    const count = Math.max(1, Math.floor(days))
    const start = addDays(end, -(count - 1))
    const values = new Map<string, number>()
    for (const point of points) {
      values.set(point.date, (values.get(point.date) ?? 0) + point.value)
    }

    return Array.from({ length: count }, (_, index) => {
      const date = dateKey(addDays(start, index))
      return { date, value: values.get(date) ?? 0 }
    })
  }

  const count = Math.max(1, Math.ceil(days / 7))
  const endOfWeek = weekStart(end)
  const start = addDays(endOfWeek, -(count - 1) * 7)

  const values = new Map<string, number>()
  for (const point of points) {
    const date = dateKey(weekStart(dateOfKey(point.date)))
    values.set(date, (values.get(date) ?? 0) + point.value)
  }

  return Array.from({ length: count }, (_, index) => {
    const date = dateKey(addDays(start, index * 7))
    return { date, value: values.get(date) ?? 0 }
  })
}
