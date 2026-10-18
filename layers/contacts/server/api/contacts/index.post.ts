import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { contactBodySchema } from '../../utils/contacts-schema'

export default defineEventHandler(async (event) => {
  const { service, addressBook, ...input } = await readValidatedBody(event, contactBodySchema)
  const provider = await useContactsProvider(service)
  const created = await provider.createContact(addressBook, input)
  await publishDomainEvent({ domain: 'contacts', service, type: 'changed', resource: addressBook })

  return { ...created, service }
})
