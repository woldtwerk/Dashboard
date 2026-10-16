import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import type { Contact } from '../../../shared/types/contacts'
import { contactDeleteSchema } from '../../utils/contacts-schema'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ status: 400, statusText: 'Missing contact uid' })
  }

  const { service, addressBook, url, etag } = await readValidatedBody(event, contactDeleteSchema)
  const provider = await useContactsProvider(service)
  const existing = { uid, addressBook, url, etag, name: '' } as Contact

  await provider.deleteContact(existing)

  return { ok: true }
})
