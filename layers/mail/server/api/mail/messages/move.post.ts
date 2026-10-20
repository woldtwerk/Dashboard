import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { moveMailMany } from '../../../utils/mail-delete'

const bodySchema = mailBatchBodySchema.extend({
  target: z.string().min(1).max(500)
})

export default defineEventHandler(async (event) => {
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { uids, target } = await readValidatedBody(event, bodySchema)

  return await moveMailMany(service, mailbox, uids, target, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: box => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: box }),
    logger: useServiceLogger('mail', service)
  })
})
