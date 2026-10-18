import type { ActivityDay, DashboardSeries } from '#layers/core/shared/types/dashboard'

/** Domains with a color of their own; everything else falls back to core. */
const DOMAIN_COLOR_TOKENS = new Set(['mail', 'calendar', 'contacts', 'drive', 'documents', 'core'])

/** CSS color of a domain. Fixed per domain, so a series keeps it in every chart. */
export function domainColor(domain: string): string {
  return `var(--chart-${DOMAIN_COLOR_TOKENS.has(domain) ? domain : 'core'})`
}

/** Display name of a domain, e.g. `mail` → `Mail`. */
export function domainLabel(domain: string): string {
  return domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : ''
}

/** Status token color, e.g. for the service health row and log level badges. */
export function statusColor(status: 'good' | 'warning' | 'serious' | 'critical'): string {
  return `var(--status-${status})`
}

/** A nice integer tick step, roughly `raw` wide, from the 1/2/5 ladder. */
function niceIntegerStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / power

  if (normalized <= 1) {
    return power
  }
  if (normalized <= 2) {
    return 2 * power
  }
  if (normalized <= 5) {
    return 5 * power
  }
  return 10 * power
}

/**
 * Explicit integer tick values for a count axis. Up to a maximum of 5 every
 * integer gets its own tick; above that the ticks use a nice integer step.
 */
export function integerTicks(max: number): number[] {
  const top = Number.isFinite(max) ? Math.max(0, Math.ceil(max)) : 0
  if (top <= 5) {
    return Array.from({ length: top + 1 }, (_, index) => index)
  }

  const step = niceIntegerStep(top / 5)
  const ticks: number[] = []
  for (let value = 0; value <= top; value += step) {
    ticks.push(value)
  }
  return ticks
}

export const CHART_RANGES = [7, 30, 90] as const
export type ChartRange = typeof CHART_RANGES[number]

/** The day range from a URL query value, clamped to one of the offered ranges. */
export function rangeFromQuery(value: unknown): ChartRange {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return (CHART_RANGES as readonly number[]).includes(parsed) ? parsed as ChartRange : 30
}

/**
 * Empty series with no points, so a chart card can show its empty state
 * instead of an axis without data.
 */
export function hasSeriesPoints(series: DashboardSeries | undefined): boolean {
  return !!series?.points?.length
}

/** Distinct domains across the activity days, in first-seen order. */
export function activityDomains(days: ActivityDay[]): string[] {
  const seen: string[] = []
  for (const day of days) {
    if (!seen.includes(day.domain)) {
      seen.push(day.domain)
    }
  }
  return seen
}

/** Distinct days, oldest first. */
export function activityDates(days: ActivityDay[]): string[] {
  return [...new Set(days.map(day => day.date))].sort((a, b) => a.localeCompare(b))
}

export interface BarChartPoint {
  date: string
  value: number
}

export interface LineChartSeries {
  key: string
  label: string
  color: string
}

export interface LineChartRow {
  date: string
  values: Record<string, number | null>
}

export interface StackedChartSeries {
  key: string
  label: string
  color: string
  icon?: string
}

export interface StackedChartRow {
  date: string
  values: Record<string, number>
}

/** One row per day for the sync duration chart: a line per domain, one shared
 * y-axis in seconds. A domain without a run on a day stays null, so its line
 * breaks instead of dropping to zero. */
export type SyncDurationRow = LineChartRow

/**
 * Y domain starting at zero for a duration chart: `[0, max * 1.1]`, or `[0, 1]`
 * without a positive value. Unovis otherwise starts at the smallest data point,
 * which draws a lone point below the plot area.
 */
export function yDomainFromZero(values: number[]): [number, number] {
  const max = values.reduce((highest, value) => Number.isFinite(value) ? Math.max(highest, value) : highest, 0)
  return [0, max > 0 ? max * 1.1 : 1]
}

export function syncDurationRows(days: ActivityDay[]): { domains: string[], rows: SyncDurationRow[] } {
  const domains = activityDomains(days)
  const byKey = new Map(days.map(day => [`${day.date}\u0000${day.domain}`, day]))

  const rows = activityDates(days).map((date) => {
    const values: Record<string, number | null> = {}
    for (const domain of domains) {
      const day = byKey.get(`${date}\u0000${domain}`)
      values[domain] = day?.medianSyncMs == null ? null : day.medianSyncMs / 1000
    }
    return { date, values }
  })

  return { domains, rows }
}

/** Warnings and errors per day, summed over the domains, oldest first. */
export function warningErrorRows(days: ActivityDay[]): StackedChartRow[] {
  const byDate = new Map<string, StackedChartRow>()
  for (const day of days) {
    const row = byDate.get(day.date) ?? { date: day.date, values: { warnings: 0, errors: 0 } }
    row.values.warnings = (row.values.warnings ?? 0) + day.warnings
    row.values.errors = (row.values.errors ?? 0) + day.errors
    byDate.set(day.date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Rows of a chart shown as a table, keyed for the generic chart card. */
export function seriesTableRows(series: DashboardSeries | undefined): { date: string, value: number }[] {
  return series?.points ?? []
}
