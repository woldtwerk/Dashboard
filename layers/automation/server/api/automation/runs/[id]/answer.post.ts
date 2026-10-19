import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const bodySchema = z.object({
  output: z.string().trim().min(1).max(200)
})

/** Answers a paused review with one of the decision's outputs */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Missing run id' })
  }

  const { output } = await readValidatedBody(event, bodySchema)
  return answerAutomationReview(id, output)
})
