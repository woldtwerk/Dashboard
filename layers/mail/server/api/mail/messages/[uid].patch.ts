import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { setMailSeen } from '../../../utils/mail-seen'

export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { seen } = await readValidatedBody(event, z.object({ seen: z.boolean() }))

  await setMailSeen(service, mailbox, uid, seen, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: () => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: mailbox }),
    logger: useServiceLogger('mail', service)
  })

  return { uid, seen }
})
