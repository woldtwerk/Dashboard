import type { MailFolders } from '#layers/mail/shared/types/mail'

/** Folders of all mail services, shared app-wide. Refresh with `refreshNuxtData('mail-folders')`. */
export function useMailFolders() {
  return useFetch<MailFolders[]>('/api/mail/folders', { key: 'mail-folders', default: () => [] })
}
