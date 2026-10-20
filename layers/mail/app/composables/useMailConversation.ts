import type { MaybeRefOrGetter } from 'vue'
import type { MailSummary } from '#layers/mail/shared/types/mail'

type NuxtApp = ReturnType<typeof useNuxtApp>
type Fetcher = ReturnType<typeof useRequestFetch>

/**
 * One cache per Nuxt app: the server hands each request its own app, the browser
 * each tab its own, so a cached conversation can never reach another visitor.
 */
const caches = new WeakMap<NuxtApp, Map<string, Promise<MailSummary[]>>>()

function conversationCache(nuxtApp: NuxtApp): Map<string, Promise<MailSummary[]>> {
  let cache = caches.get(nuxtApp)
  if (!cache) {
    cache = new Map()
    caches.set(nuxtApp, cache)
  }
  return cache
}

const cacheKey = (service: string, key: string) => `${service}:${key}`

/**
 * A conversation's mails; an in-flight request is shared, a resolved one is kept.
 * `fetcher` is the caller's request-scoped fetch, so a server render forwards the
 * session cookie the same way `useFetch` does.
 */
export function loadMailConversation(nuxtApp: NuxtApp, fetcher: Fetcher, service: string, key: string): Promise<MailSummary[]> {
  const cache = conversationCache(nuxtApp)
  const id = cacheKey(service, key)
  let request = cache.get(id)
  if (!request) {
    request = fetcher<MailSummary[]>(`/api/mail/conversations/${encodeURIComponent(key)}`, { query: { service } })
    cache.set(id, request)
    request.catch(() => cache.delete(id))
  }
  return request
}

/** Warm a conversation the panel is about to open; the panel reuses the very same request */
export function prefetchMailConversation(nuxtApp: NuxtApp, fetcher: Fetcher, service: string, key: string) {
  loadMailConversation(nuxtApp, fetcher, service, key).catch(() => {})
}

/**
 * The open conversation's mails. The key is stable per selection, so the panel,
 * a hover prefetch and a remount all share one request. `refresh()` drops the
 * cached copy first, so a reload after a reply or a change really asks again.
 */
export function useMailConversation(conversationKey: MaybeRefOrGetter<string | undefined>, service: MaybeRefOrGetter<string>) {
  const nuxtApp = useNuxtApp()
  const requestFetch = useRequestFetch()
  const asyncData = useAsyncData<MailSummary[]>(
    () => `mail-conversation:${toValue(service)}:${toValue(conversationKey) ?? ''}`,
    async () => {
      const key = toValue(conversationKey)
      return key ? loadMailConversation(nuxtApp, requestFetch, toValue(service), key) : []
    },
    { default: () => [], lazy: true }
  )

  const reload = asyncData.refresh
  asyncData.refresh = (...args) => {
    const key = toValue(conversationKey)
    if (key) {
      conversationCache(nuxtApp).delete(cacheKey(toValue(service), key))
    }
    return reload(...args)
  }

  return asyncData
}
