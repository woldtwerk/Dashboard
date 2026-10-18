import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler(async () => getNavigationPreferences())
