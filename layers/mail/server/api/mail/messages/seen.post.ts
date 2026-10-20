import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { setMailSeenMany } from '../../../utils/mail-seen'

const bodySchema = mailBatchBodySchema.extend({
  seen: z.boolean()
})

export default defineEventHandler(async (event) => {
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { uids, seen } = await readValidatedBody(event, bodySchema)

  await setMailSeenMany(service, mailbox, uids, seen, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: () => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: mailbox }),
    logger: useServiceLogger('mail', service)
  })

  return { uids, seen }
})
