import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { isValidLabelName, LABEL_NAME_MAX } from '../../../../shared/mail-labels'
import { setMailLabelMany } from '../../../utils/mail-labels'

const bodySchema = mailBatchBodySchema.extend({
  label: z.string().trim().max(LABEL_NAME_MAX).refine(isValidLabelName, 'Invalid label name'),
  on: z.boolean()
})

export default defineEventHandler(async (event) => {
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { uids, label, on } = await readValidatedBody(event, bodySchema)

  const { unresolved } = await setMailLabelMany(service, mailbox, uids, label, on, {
    provider: await useMailProvider(service),
    index: useMailSearchIndex(),
    publish: box => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: box }),
    logger: useServiceLogger('mail', service)
  })

  return { uids, label, on, unresolved }
})
