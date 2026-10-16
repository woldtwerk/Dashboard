import { defineEventHandler, getRouterParam } from 'nuxt/server'

// Wizard for editing an existing service, without its secrets
export default defineEventHandler(async (event) => {
  const service = await getService(getRouterParam(event, 'id')!)

  return getSetupState(getConnector(service.connector), service)
})
