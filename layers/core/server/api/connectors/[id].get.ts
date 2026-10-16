import { defineEventHandler, getRouterParam } from 'nuxt/server'

// Wizard for a new service of this connector
export default defineEventHandler((event) => {
  return getSetupState(getConnector(getRouterParam(event, 'id')!))
})
