/**
 * The IANA time zone the calendar renders in. Resolved by the core
 * `useTimeZone`, with the calendar's own configured zone as the fallback; see
 * there for the settings/cookie/browser order.
 */
export function useCalendarTimeZone() {
  return useTimeZone(useRuntimeConfig().public.calendar.timeZone)
}
