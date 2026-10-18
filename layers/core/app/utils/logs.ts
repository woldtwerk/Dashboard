import type { LogEntry, LogLevel, LogQuery } from '#layers/core/shared/types/logs'

/** Entries kept in memory while live streaming. */
export const LOG_CAP = 1000

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

/** Select value standing in for "no service filter"; Reka rejects an empty one. */
export const LOG_ALL_SERVICES = 'all'

const LEVEL_SET = new Set<string>(LOG_LEVELS)

/** URL state of the log view; `before` is the pagination cursor, not a filter. */
export interface LogFilters {
  domains: string[]
  services: string[]
  levels: LogLevel[]
  q: string
  live: boolean
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item !== '')
  }
  return typeof value === 'string' && value !== '' ? [value] : []
}

/** Read the filters out of the route query; unknown domains/levels are dropped. */
export function logQueryFromRoute(query: Record<string, unknown>): LogFilters {
  return {
    domains: asStringArray(query.domain),
    services: asStringArray(query.service).filter(service => service !== LOG_ALL_SERVICES),
    levels: asStringArray(query.level).filter((level): level is LogLevel => LEVEL_SET.has(level)),
    q: typeof query.q === 'string' ? query.q : '',
    live: query.live !== '0'
  }
}

/** Serialize the filters back into a route query; empty filters are omitted. */
export function logQueryToRoute(filters: LogFilters): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  const services = filters.services.filter(service => service !== LOG_ALL_SERVICES)
  if (filters.domains.length) {
    query.domain = filters.domains
  }
  if (services.length) {
    query.service = services
  }
  if (filters.levels.length) {
    query.level = filters.levels
  }
  if (filters.q.trim()) {
    query.q = filters.q.trim()
  }
  if (!filters.live) {
    query.live = '0'
  }
  return query
}

/** The API query for a filtered log request. */
export function logFetchQuery(filters: LogFilters, options: { before?: number, limit?: number } = {}): LogQuery {
  return {
    domains: filters.domains.length ? filters.domains : undefined,
    services: filters.services.length ? filters.services : undefined,
    levels: filters.levels.length ? filters.levels : undefined,
    before: options.before,
    limit: options.limit
  }
}

/** Query string for `/api/logs` and `/api/logs/stream`, sidestepping Nitro's typed routes. */
export function toLogQueryString(query: LogQuery): string {
  const params = new URLSearchParams()
  for (const domain of query.domains ?? []) {
    params.append('domains', domain)
  }
  for (const service of query.services ?? []) {
    params.append('services', service)
  }
  for (const level of query.levels ?? []) {
    params.append('levels', level)
  }
  if (query.before !== undefined) {
    params.set('before', String(query.before))
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit))
  }
  return params.toString()
}

/** Whether an entry passes the client-side text filter. */
export function matchesText(entry: LogEntry, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) {
    return true
  }
  return entry.message.toLowerCase().includes(needle)
    || entry.service?.toLowerCase().includes(needle) === true
    || entry.domain.toLowerCase().includes(needle)
}

/**
 * Merge new entries into the loaded ones: dedupe by id, newest first, capped.
 * The incoming copy wins, so a streamed entry can replace a stale page entry.
 */
export function mergeLogEntries(existing: LogEntry[], incoming: LogEntry[], cap = LOG_CAP): LogEntry[] {
  const byId = new Map<number, LogEntry>()
  for (const entry of incoming) {
    byId.set(entry.id, entry)
  }
  for (const entry of existing) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry)
    }
  }
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap)
}

export interface LogLevelMeta {
  label: string
  icon: string
  /** Nuxt UI badge color. */
  tone: 'neutral' | 'warning' | 'error'
  /** CSS color from the status tokens. */
  color: string
}

/** Badge label, icon and color of a log level, never color alone. */
export function logLevelMeta(level: LogLevel): LogLevelMeta {
  switch (level) {
    case 'warn':
      return { label: 'Warning', icon: 'i-lucide-triangle-alert', tone: 'warning', color: 'var(--status-warning)' }
    case 'error':
      return { label: 'Error', icon: 'i-lucide-circle-alert', tone: 'error', color: 'var(--status-critical)' }
    case 'debug':
      return { label: 'Debug', icon: 'i-lucide-bug', tone: 'neutral', color: 'var(--ui-text-dimmed)' }
    default:
      return { label: 'Info', icon: 'i-lucide-info', tone: 'neutral', color: 'var(--ui-text-muted)' }
  }
}
