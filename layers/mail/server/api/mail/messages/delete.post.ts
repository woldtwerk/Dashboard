import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { deleteMailMany } from '../../../utils/mail-delete'

const bodySchema = mailBatchBodySchema.extend({
  permanent: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { uids, permanent = false } = await readValidatedBody(event, bodySchema)

  return await deleteMailMany(service, mailbox, uids, { permanent }, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: box => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: box }),
    logger: useServiceLogger('mail', service)
  })
})
