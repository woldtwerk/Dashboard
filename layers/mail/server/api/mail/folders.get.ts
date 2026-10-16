import { defineEventHandler, isNuxtError } from 'nuxt/server'
import type { MailFolders } from '../../../shared/types/mail'

// Folders of all mail services; one unreachable service doesn't break the others
export default defineEventHandler(async () => {
  const services = await listServices('mail')

  return Promise.all(services.map(async ({ id, name, icon }): Promise<MailFolders> => {
    try {
      return { service: { id, name, icon }, mailboxes: await (await useMailProvider(id)).listMailboxes() }
    } catch (error) {
      return { service: { id, name, icon }, mailboxes: [], error: (isNuxtError(error) && error.statusText) || 'Unavailable' }
    }
  }))
})
