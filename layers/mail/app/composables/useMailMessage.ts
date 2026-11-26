import type { MaybeRefOrGetter } from 'vue'
import type { MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import { MAIL_MESSAGE_GC_TIME } from '#layers/mail/app/utils/mail-cache'

type QueryCache = ReturnType<typeof useQueryCache>
type Fetcher = ReturnType<typeof useRequestFetch>

/** Uids repeat across accounts and folders, so the service and mailbox are part of the key. */
export function mailMessageQueryKey(service: string, mailbox: string, uid: number) {
  return ['mail', service, 'message', mailbox, uid] as const
}

/** The one query the reader, a prefetch and a remount share. */
export function mailMessageQueryOptions(fetcher: Fetcher, service: string, mailbox: string, uid: number) {
  return {
    key: mailMessageQueryKey(service, mailbox, uid),
    query: () => fetcher<MailMessage>(`/api/mail/messages/${uid}`, { query: { service, mailbox } }),
    gcTime: MAIL_MESSAGE_GC_TIME
  }
}

/**
 * A mail's full body from the shared cache: a fresh entry answers without a
 * request, an in-flight one is joined, and a failed query throws.
 */
export async function loadMailMessage(
  queryCache: QueryCache,
  fetcher: Fetcher,
  service: string,
  mailbox: string,
  uid: number
): Promise<MailMessage> {
  const entry = queryCache.ensure(mailMessageQueryOptions(fetcher, service, mailbox, uid))
  const { data, error } = await queryCache.refresh(entry)
  if (error) throw error
  return data!
}

/** Warm a mail the reader or composer is about to open; fire and forget. */
export function prefetchMailMessage(
  queryCache: QueryCache,
  fetcher: Fetcher,
  service: string,
  mailbox: string,
  uid: number
): void {
  queryCache.refresh(queryCache.ensure(mailMessageQueryOptions(fetcher, service, mailbox, uid))).then(() => {}, () => {})
}

/**
 * The open mail's body. The key is stable per selection, so the reader, a hover
 * prefetch and a remount share one request. `refresh` here forces a new request
 * even while the entry is still fresh.
 */
export function useMailMessage(
  mail: MaybeRefOrGetter<Pick<MailSummary, 'uid' | 'mailbox'> | undefined>,
  service: MaybeRefOrGetter<string>
) {
  const fetcher = useRequestFetch()
  const query = useQuery<MailMessage, Error & { statusMessage?: string }>({
    key: () => {
      const current = toValue(mail)
      return mailMessageQueryKey(toValue(service), current?.mailbox ?? '', current?.uid ?? 0)
    },
    // Never called without a selection; `enabled` guards it
    query: () => fetcher<MailMessage>(`/api/mail/messages/${toValue(mail)?.uid ?? 0}`, {
      query: { service: toValue(service), mailbox: toValue(mail)?.mailbox ?? '' }
    }),
    enabled: () => !!toValue(mail),
    gcTime: MAIL_MESSAGE_GC_TIME,
    ssrCatchError: true
  })

  // A reload must ask again even while the entry is fresh
  return { ...query, refresh: query.refetch }
}
