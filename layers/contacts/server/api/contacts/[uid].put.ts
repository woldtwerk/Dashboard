import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import type { Contact } from '../../../shared/types/contacts'
import { contactUpdateSchema } from '../../utils/contacts-schema'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ status: 400, statusText: 'Missing contact uid' })
  }

  const { service, addressBook, url, etag, ...input } = await readValidatedBody(event, contactUpdateSchema)
  const provider = await useContactsProvider(service)
  const existing = { uid, addressBook, url, etag, name: input.name ?? '' } as Contact

  await provider.updateContact(existing, input)
  if (url) {
    await syncCachedCardAfterWrite(service, addressBook, url)
  }
  await publishDomainEvent({ domain: 'contacts', service, type: 'changed', resource: addressBook })

  return { ok: true }
})
