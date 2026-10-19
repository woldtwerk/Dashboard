import { formatZoned, isSameZonedDay } from '#layers/core/shared/date-format'

/**
 * Time of day for a list row: `HH:mm` when the mail arrived today in `zone`,
 * otherwise `dd MMM`. Both the date and "today" are read in `zone`, so the
 * server (usually UTC) and the browser render the same string.
 */
export function formatMailListDate(date: string | Date, zone: string, now = new Date()): string {
  return isSameZonedDay(date, now, zone) ? formatZoned(date, zone, 'HH:mm') : formatZoned(date, zone, 'dd MMM')
}

/** Full date and time of a mail, e.g. `05 Mar 2025 09:38`, in `zone`. */
export function formatMailFullDate(date: string | Date, zone: string): string {
  return formatZoned(date, zone, 'dd MMM yyyy HH:mm')
}
