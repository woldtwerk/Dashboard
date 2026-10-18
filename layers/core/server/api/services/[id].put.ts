import { defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const service = await getService(getRouterParam(event, 'id')!)
  const body = await readValidatedBody(event, setupBodySchema)
  const connector = getConnector(service.connector)
  const values = await resolveSetupValues(connector, body.values, service)

  await connector.test?.(values, { serviceId: service.id })

  return saveService({ id: service.id, connector, name: body.name, values })
})
