import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const { service, mailbox } = await getValidatedQuery(event, mailboxQuerySchema)
  const { seen } = await readValidatedBody(event, z.object({ seen: z.boolean() }))

  await (await useMailProvider(service)).setSeen(mailbox, uid, seen)

  return { uid, seen }
})
