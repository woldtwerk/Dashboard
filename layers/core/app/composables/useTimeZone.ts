import type { GeneralSettings } from '#layers/core/shared/types/settings'

const COOKIE_AGE = 60 * 60 * 24 * 365

/**
 * The IANA time zone the dashboard renders times in, so the server and the
 * client agree on the same strings. A zone stored in the `general` settings is
 * authoritative. Otherwise the `tz` cookie is used and reaches the server
 * render; without it the browser's zone is adopted once mounted — after
 * hydration, so the first client pass still matches the server — and written
 * back to the cookie for the next request. The server falls back to the
 * configured zone (`public.timeZone`), or `fallback` when a caller passes one.
 */
export function useTimeZone(fallback?: string) {
  const configuredFallback = fallback || useRuntimeConfig().public.timeZone
  const cookie = useCookie<string | null>('tz', { maxAge: COOKIE_AGE, sameSite: 'lax' })
  const zone = ref(cookie.value || configuredFallback)
  const { data: general } = useSettings<GeneralSettings>('general')
  const configured = computed(() => general.value.timeZone || undefined)

  if (import.meta.client) {
    onMounted(() => {
      // An explicit setting wins over the browser, so do not adopt it then
      if (configured.value) {
        return
      }

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

  return computed(() => configured.value || zone.value || configuredFallback)
}
