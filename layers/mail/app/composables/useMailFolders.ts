import type { MailFolders } from '#layers/mail/shared/types/mail'
import { MAIL_QUERY_GC_TIME } from '#layers/mail/app/utils/mail-cache'

type QueryCache = ReturnType<typeof useQueryCache>
type Fetcher = ReturnType<typeof useRequestFetch>

/** Folders of all mail services, shared app-wide. */
export const MAIL_FOLDERS_KEY = ['mail', 'folders'] as const

/** One request covers the folders of every service. */
export function mailFoldersQueryOptions(fetcher: Fetcher) {
  return {
    key: MAIL_FOLDERS_KEY,
    query: () => fetcher<MailFolders[]>('/api/mail/folders'),
    gcTime: MAIL_QUERY_GC_TIME
  }
}

/** Folders of all mail services, shared app-wide; the data defaults to a list. */
export function useMailFolders() {
  const fetcher = useRequestFetch()
  const query = useQuery<MailFolders[]>({ ...mailFoldersQueryOptions(fetcher), ssrCatchError: true })
  const data = computed(() => query.data.value ?? [])
  return { ...query, data }
}

/**
 * Force a folder refetch after a write or a `changed` event. The response may
 * otherwise come from the server's shared cache, which can still hold the old
 * counts, so the request asks for a fresh read. An in-flight folders request is
 * cancelled first, so an older response cannot land on top of the fresh counts.
 */
export function refetchMailFolders(queryCache: QueryCache, fetcher: Fetcher): Promise<void> {
  queryCache.cancelQueries({ key: MAIL_FOLDERS_KEY })

  return fetcher<MailFolders[]>('/api/mail/folders', { query: { fresh: '1' } })
    .then((folders) => {
      queryCache.setQueryData(MAIL_FOLDERS_KEY, folders)
    })
    .catch(() => {})
}
