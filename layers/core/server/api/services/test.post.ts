import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    connector: z.string(),
    service: z.string().optional(),
    values: z.record(z.string(), z.unknown())
  }))
  const connector = getConnector(body.connector)
  const service = body.service ? await getService(body.service) : undefined
  assertSameConnector(service, connector.id)
  const values = await resolveSetupValues(connector, body.values, service)

  await connector.test?.(values, { serviceId: body.service })

  return { ok: true }
})
