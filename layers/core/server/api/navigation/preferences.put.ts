import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const preferences = await readValidatedBody(event, navigationPreferencesSchema)

  return saveNavigationPreferences(preferences)
})
