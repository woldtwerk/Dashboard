import { z } from 'zod'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { deleteSubscription } from '../../db/push-subscription-repository'

const bodySchema = z.object({
  endpoint: z.string().url()
})

/** Removes a subscription after the browser unsubscribed locally. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema)
  const db = await useDb()

  await deleteSubscription(db, body.endpoint)

  return { ok: true }
})
