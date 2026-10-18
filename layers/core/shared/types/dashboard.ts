/**
 * Dashboard API contract
 *
 * - GET /api/dashboard/services → ServiceStatus[]
 * - GET /api/dashboard/metrics → DashboardMetric[]
 * - GET /api/dashboard/series → DashboardSeriesInfo[]; GET /api/dashboard/series/:id?days=30 → DashboardSeries
 * - GET /api/logs?domains=&services=&levels=&before=&limit= → LogEntry[] (newest first)
 * - GET /api/logs/stream?domains=&services=&levels= → SSE, `event: log`, data = LogEntry
 * - GET /api/logs/activity?days=14 → ActivityDay[]
 */

export type ServiceHealth = 'ok' | 'syncing' | 'error' | 'unknown'

export interface ServiceStatus {
  id: string
  name: string
  domain: string
  icon?: string
  health: ServiceHealth
  /** ISO time of the last completed sync; null if never or not syncing */
  syncedAt: string | null
  error?: string
}

/** A headline number for a stat tile */
export interface DashboardMetric {
  id: string
  domain: string
  label: string
  /** null = not available (e.g. service not set up or source unreachable) */
  value: number | null
  unit?: 'count' | 'bytes'
  icon?: string
  /** Page the tile links to */
  to?: string
}

export interface DashboardSeriesInfo {
  id: string
  domain: string
  label: string
  /** Bucket size of the points */
  bucket: 'day' | 'week'
}

export interface DashboardSeries extends DashboardSeriesInfo {
  /** One point per bucket, oldest first; dates as YYYY-MM-DD (bucket start) */
  points: { date: string, value: number }[]
}

/** Per day and domain: how many warn/error lines and sync runs there were */
export interface ActivityDay {
  date: string
  domain: string
  warnings: number
  errors: number
  syncRuns: number
  /** Median sync duration that day; null without runs */
  medianSyncMs: number | null
}
