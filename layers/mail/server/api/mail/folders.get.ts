import { defineEventHandler, getQuery, isNuxtError } from 'nuxt/server'
import { cachedSwr } from '../../../../core/server/utils/swr-cache'
import { MAIL_FOLDERS_SWR, mailFoldersKey } from '../../utils/mail-folders-cache'
import type { MailFolders } from '../../../shared/types/mail'

// Folders of all mail services; one unreachable service doesn't break the others
export default defineEventHandler(async (event) => {
  const services = await listServices('mail')
  const force = getQuery(event).fresh === '1'

  return Promise.all(services.map(async ({ id, name, icon }): Promise<MailFolders> => {
    try {
      const mailboxes = await cachedSwr(
        mailFoldersKey(id),
        async () => (await useMailProvider(id)).listMailboxes(),
        { ...MAIL_FOLDERS_SWR, force }
      )
      return { service: { id, name, icon }, mailboxes }
    } catch (error) {
      return { service: { id, name, icon }, mailboxes: [], error: (isNuxtError(error) && error.statusText) || 'Unavailable' }
    }
  }))
})
