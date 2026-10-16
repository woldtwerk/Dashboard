import { generateText, Output } from 'ai'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { aiSearchSchema, normalizeAiSearch, searchInstructions } from '../../../mail-ai/search'

// Natural language → search criteria for the mail page
export default defineEventHandler(async (event) => {
  const { text } = await readValidatedBody(event, z.object({ text: z.string().trim().min(1).max(500) }))
  const { model, headers } = await useAiModel()

  const result = await generateText({
    model,
    headers,
    system: searchInstructions(new Date().toISOString().slice(0, 10)),
    prompt: text,
    output: Output.object({ schema: aiSearchSchema })
  })

  return normalizeAiSearch(result.output)
})
