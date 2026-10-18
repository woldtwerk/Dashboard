const COOKIE_AGE = 60 * 60 * 24 * 365

/**
 * The IANA time zone the calendar renders in. The `tz` cookie is authoritative
 * and reaches the server render; without it the browser's zone is adopted once
 * mounted — after hydration, so the first client pass still matches the
 * server — and written back to the cookie for the next request. The server
 * falls back to the configured zone.
 */
export function useCalendarTimeZone() {
  const fallback = useRuntimeConfig().public.calendar.timeZone
  const cookie = useCookie<string | null>('tz', { maxAge: COOKIE_AGE, sameSite: 'lax' })
  const zone = ref(cookie.value || fallback)

  if (import.meta.client) {
    onMounted(() => {
      const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!browser) {
        return
      }

      if (browser !== zone.value) {
        zone.value = browser
      }
      if (cookie.value !== browser) {
        cookie.value = browser
      }
    })
  }

  return computed(() => zone.value || fallback)
}
