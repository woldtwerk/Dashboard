import type { MaybeRefOrGetter } from 'vue'
import type { MailSummary } from '#layers/mail/shared/types/mail'
import { MAIL_QUERY_GC_TIME } from '#layers/mail/app/utils/mail-cache'

type QueryCache = ReturnType<typeof useQueryCache>
type Fetcher = ReturnType<typeof useRequestFetch>

/** The key is stable per service and conversation, so the panel, a prefetch and a remount share one entry. */
export function mailConversationQueryKey(service: string, key: string) {
  return ['mail', service, 'conversation', key] as const
}

/** The one query the panel and a prefetch share. */
export function mailConversationQueryOptions(fetcher: Fetcher, service: string, key: string) {
  return {
    key: mailConversationQueryKey(service, key),
    query: () => fetcher<MailSummary[]>(`/api/mail/conversations/${encodeURIComponent(key)}`, { query: { service } }),
    gcTime: MAIL_QUERY_GC_TIME
  }
}

/**
 * A conversation's mails from the shared cache: a fresh entry answers without a
 * request, an in-flight one is joined, and a failed query throws.
 */
export async function loadMailConversation(
  queryCache: QueryCache,
  fetcher: Fetcher,
  service: string,
  key: string
): Promise<MailSummary[]> {
  const entry = queryCache.ensure(mailConversationQueryOptions(fetcher, service, key))
  const { data, error } = await queryCache.refresh(entry)
  if (error) throw error
  return data!
}

/** Warm a conversation the panel is about to open; fire and forget. */
export function prefetchMailConversation(
  queryCache: QueryCache,
  fetcher: Fetcher,
  service: string,
  key: string
): void {
  queryCache.refresh(queryCache.ensure(mailConversationQueryOptions(fetcher, service, key))).then(() => {}, () => {})
}

/**
 * The open conversation's mails. The key is stable per selection, so the panel,
 * a hover prefetch and a remount share one request. A reply or a seen change
 * must force the reload, hence `refresh` maps to `refetch`.
 */
export function useMailConversation(conversationKey: MaybeRefOrGetter<string | undefined>, service: MaybeRefOrGetter<string>) {
  const fetcher = useRequestFetch()
  const query = useQuery<MailSummary[], Error & { statusMessage?: string }>({
    key: () => mailConversationQueryKey(toValue(service), toValue(conversationKey) ?? ''),
    // Never called without a conversation; `enabled` guards it
    query: () => fetcher<MailSummary[]>(`/api/mail/conversations/${encodeURIComponent(toValue(conversationKey) ?? '')}`, {
      query: { service: toValue(service) }
    }),
    enabled: () => !!toValue(conversationKey),
    gcTime: MAIL_QUERY_GC_TIME,
    ssrCatchError: true
  })

  const data = computed(() => query.data.value ?? [])
  return { ...query, data, refresh: query.refetch }
}
