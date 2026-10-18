import { createError, defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { OUTGOING_MESSAGE_ID_LIMIT, OUTGOING_MESSAGE_ID_PATTERN, OUTGOING_REFERENCES_LIMIT, OUTGOING_SUBJECT_LIMIT } from '../../../shared/mail-compose'
import { mailAccountAddress } from '../../utils/mail-identity'
import { sendMail } from '../../utils/mail-send'

const addressSchema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(320).optional()
})

/** A Message-ID is a single, whitespace-free token so it cannot start a header */
const messageIdSchema = z.string().max(OUTGOING_MESSAGE_ID_LIMIT).regex(OUTGOING_MESSAGE_ID_PATTERN)

/** The body mirrors `OutgoingMail`, plus the mail a reply answers */
const sendBodySchema = z.object({
  to: z.array(addressSchema).default([]),
  cc: z.array(addressSchema).default([]),
  bcc: z.array(addressSchema).default([]),
  subject: z.string().max(OUTGOING_SUBJECT_LIMIT).regex(/^[^\r\n]*$/).default(''),
  text: z.string().default(''),
  inReplyTo: messageIdSchema.optional(),
  references: z.array(messageIdSchema).max(OUTGOING_REFERENCES_LIMIT).optional(),
  reply: z.object({
    mailbox: z.string().min(1),
    uid: z.number().int().positive()
  }).optional()
})

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, serviceQuerySchema)
  const { reply, ...mail } = await readValidatedBody(event, sendBodySchema)

  const provider = await useMailProvider(service)
  const address = await mailAccountAddress(service)

  if (!address) {
    throw createError({ status: 500, statusText: 'The mail account has no sender address' })
  }

  const result = await sendMail(mail, reply, {
    provider,
    from: { address },
    // Bridge keeps the flag itself; only a provider offering the generic setter is used
    markAnswered: provider.setAnswered
      ? (mailbox: string, uid: number) => provider.setAnswered!(mailbox, uid, true)
      : undefined,
    publish: () => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: 'Sent' }),
    logger: useServiceLogger('mail', service)
  })

  if (result.status !== 200) {
    throw createError({ status: result.status, statusText: result.error })
  }

  return { messageId: result.messageId }
})
