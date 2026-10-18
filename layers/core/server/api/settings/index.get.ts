import { defineEventHandler } from 'nuxt/server'

/** Every registered settings section, already merged over its defaults. */
export default defineEventHandler(async () => {
  const entries = await Promise.all(listSettingsSections().map(async section => [section, await getSettings(section)] as const))

  return Object.fromEntries(entries)
})
