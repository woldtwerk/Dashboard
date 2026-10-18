import type { ActivityDay } from '../../shared/types/dashboard'
import type { LogLevel } from '../../shared/types/logs'

export interface ActivityLogRow {
  at: Date
  level: LogLevel
  domain: string
}

export interface ActivityRunRow {
  startedAt: Date
  domain: string
  durationMs: number
}

/** Median of the values; null for an empty list. Even counts average the middle two. */
export function median(values: number[]): number | null {
  if (!values.length) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Groups log lines and sync runs into the per-day, per-domain rows the activity
 * chart shows. Days are UTC, matching the stored timestamps and the API contract.
 */
export function buildActivityDays(entries: ActivityLogRow[], runs: ActivityRunRow[]): ActivityDay[] {
  const days = new Map<string, ActivityDay & { durations: number[] }>()

  function dayOf(date: Date, domain: string) {
    const dateKey = utcDay(date)
    const key = `${dateKey}\u0000${domain}`
    let day = days.get(key)

    if (!day) {
      day = { date: dateKey, domain, warnings: 0, errors: 0, syncRuns: 0, medianSyncMs: null, durations: [] }
      days.set(key, day)
    }

    return day
  }

  for (const entry of entries) {
    const day = dayOf(entry.at, entry.domain)
    if (entry.level === 'warn') {
      day.warnings++
    } else if (entry.level === 'error') {
      day.errors++
    }
  }

  for (const run of runs) {
    const day = dayOf(run.startedAt, run.domain)
    day.syncRuns++
    day.durations.push(run.durationMs)
  }

  return [...days.values()]
    .map(({ durations, ...day }) => ({ ...day, medianSyncMs: median(durations) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.domain.localeCompare(b.domain))
}
