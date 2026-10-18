import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { deleteMail } from '../../../../utils/mail-delete'

export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { permanent = false } = await readValidatedBody(event, z.object({ permanent: z.boolean().optional() }))

  return await deleteMail(service, mailbox, uid, { permanent }, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: box => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: box }),
    logger: useServiceLogger('mail', service)
  })
})
