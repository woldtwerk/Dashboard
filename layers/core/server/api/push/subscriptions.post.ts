import { z } from 'zod'
import { defineEventHandler, getRequestHeader, readValidatedBody } from 'nuxt/server'
import { upsertSubscription } from '../../db/push-subscription-repository'

const bodySchema = z.object({
  endpoint: z.string().url().refine(value => value.startsWith('https://'), 'The push endpoint must be an https URL'),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
})

/** Stores or refreshes this browser's push subscription, keyed by its endpoint. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema)
  const db = await useDb()

  const subscription = await upsertSubscription(db, {
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: getRequestHeader(event, 'user-agent') ?? undefined
  })

  return { ok: true, id: subscription.id }
})
