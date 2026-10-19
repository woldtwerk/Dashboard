import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Dates the app shows are formatted in one IANA zone, resolved by
 * `useTimeZone`, and always with a fixed pattern — a locale- or process-zone
 * dependent formatter (`toLocaleString`, `Intl.DateTimeFormat` without a
 * `timeZone`) renders one string on the server (usually UTC) and another in the
 * browser, which breaks hydration.
 */

/** The instant in `zone`, so date-fns reads its parts there and not in the process zone. */
export function zoned(date: string | Date, zone: string): TZDate {
  const instant = date instanceof Date ? date : new Date(date)
  return new TZDate(instant.getTime(), zone)
}

/** `date` rendered in `zone` with a fixed date-fns `pattern`, e.g. `dd MMM yyyy HH:mm`. */
export function formatZoned(date: string | Date, zone: string, pattern: string): string {
  return format(zoned(date, zone), pattern)
}

/** Whether two instants fall on the same calendar day in `zone`. */
export function isSameZonedDay(left: string | Date, right: string | Date, zone: string): boolean {
  return formatZoned(left, zone, 'yyyy-MM-dd') === formatZoned(right, zone, 'yyyy-MM-dd')
}

/** Local midnight of `date`'s day in `zone`. */
export function startOfZonedDay(date: string | Date, zone: string): TZDate {
  const zonedDate = zoned(date, zone)
  return new TZDate(zonedDate.getFullYear(), zonedDate.getMonth(), zonedDate.getDate(), zone)
}
