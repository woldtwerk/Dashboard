import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, setupBodySchema.extend({ connector: z.string() }))
  const connector = getConnector(body.connector)
  const values = await resolveSetupValues(connector, body.values)

  // Only persist settings that actually work
  await connector.test?.(values)

  return saveService({ connector, name: body.name, values })
})
