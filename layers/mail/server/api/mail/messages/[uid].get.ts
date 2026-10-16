import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)

  const message = await (await useMailProvider(service)).getMessage(mailbox, uid)

  if (!message) {
    throw createError({ status: 404, statusText: 'Message not found' })
  }

  return message
})
