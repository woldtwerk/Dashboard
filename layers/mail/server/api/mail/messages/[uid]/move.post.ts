import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { moveMail } from '../../../../utils/mail-delete'

export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { target } = await readValidatedBody(event, z.object({ target: z.string().min(1).max(500) }))

  return await moveMail(service, mailbox, uid, target, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: box => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: box }),
    logger: useServiceLogger('mail', service)
  })
})
