import { defineEventHandler } from 'nuxt/server'

/** The runs waiting for a human answer, for the Activity badges */
export default defineEventHandler(async () => ({ count: await countRunsAwaitingReview() }))
