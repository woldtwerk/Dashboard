import { defineEventHandler } from 'nuxt/server'
import { listAppPasswords } from '../../db/app-password-repository'

// App passwords as the settings page lists them; hashes stay in the database
export default defineEventHandler(async () => {
  return await listAppPasswords(await useDb())
})
