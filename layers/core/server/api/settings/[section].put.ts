import { createError, defineEventHandler, getRouterParam, readBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const section = getRouterParam(event, 'section')!

  if (!hasSettingsSection(section)) {
    throw createError({ status: 404, statusText: `Unknown settings section "${section}"` })
  }

  const parsed = parseSettings(section, await readBody(event))
  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: parsed.error.issues[0]?.message ?? `Invalid settings for "${section}"`
    })
  }

  return saveSettings(section, parsed.data)
})
