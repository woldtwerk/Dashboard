import type { MaybeRefOrGetter } from 'vue'
import type { MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import { mailMessageCacheKey, rememberMailMessage, type MailMessageRequests } from '#layers/mail/app/utils/mail-message-cache'

type NuxtApp = ReturnType<typeof useNuxtApp>
type Fetcher = ReturnType<typeof useRequestFetch>

/**
 * One cache per Nuxt app: the server hands each request its own app, the browser
 * each tab its own, so a cached message can never reach another visitor.
 */
const caches = new WeakMap<NuxtApp, MailMessageRequests>()

function messageCache(nuxtApp: NuxtApp): MailMessageRequests {
  let cache = caches.get(nuxtApp)
  if (!cache) {
    cache = new Map()
    caches.set(nuxtApp, cache)
  }
  return cache
}

/**
 * A mail's full body; an in-flight request is shared, a resolved one is kept
 * (capped, oldest first). `fetcher` is the caller's request-scoped fetch, so a
 * server render forwards the session cookie the same way `useFetch` does.
 */
export function loadMailMessage(
  nuxtApp: NuxtApp,
  fetcher: Fetcher,
  service: string,
  mailbox: string,
  uid: number
): Promise<MailMessage> {
  const cache = messageCache(nuxtApp)
  const key = mailMessageCacheKey(service, mailbox, uid)
  const cached = cache.get(key)
  if (cached) {
    return cached
  }

  const request = fetcher<MailMessage>(`/api/mail/messages/${uid}`, { query: { service, mailbox } })
  rememberMailMessage(cache, key, request)
  // A failure leaves nothing to share; a newer request for the same key stays
  request.catch(() => {
    if (cache.get(key) === request) {
      cache.delete(key)
    }
  })
  return request
}

/** Warm a mail the reader or composer is about to open; both reuse the very same request */
export function prefetchMailMessage(nuxtApp: NuxtApp, fetcher: Fetcher, service: string, mailbox: string, uid: number) {
  loadMailMessage(nuxtApp, fetcher, service, mailbox, uid).catch(() => {})
}

/**
 * The open mail's body. The key is stable per selection, so the reader, a hover
 * prefetch and a remount all share one request. `refresh()` drops the cached copy
 * first, so a reload really asks again.
 */
export function useMailMessage(
  mail: MaybeRefOrGetter<Pick<MailSummary, 'uid' | 'mailbox'> | undefined>,
  service: MaybeRefOrGetter<string>
) {
  const nuxtApp = useNuxtApp()
  const requestFetch = useRequestFetch()

  const asyncData = useAsyncData<MailMessage | null>(
    () => {
      const current = toValue(mail)
      return `mail-message:${toValue(service)}:${current?.mailbox ?? ''}:${current?.uid ?? ''}`
    },
    () => {
      const current = toValue(mail)
      return current
        ? loadMailMessage(nuxtApp, requestFetch, toValue(service), current.mailbox, current.uid)
        : Promise.resolve(null)
    },
    { default: () => null, lazy: true }
  )

  const reload = asyncData.refresh
  asyncData.refresh = (...args) => {
    const current = toValue(mail)
    if (current) {
      messageCache(nuxtApp).delete(mailMessageCacheKey(toValue(service), current.mailbox, current.uid))
    }
    return reload(...args)
  }

  return asyncData
}
