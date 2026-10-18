import { defineEventHandler } from 'nuxt/server'

/** Categories the settings UI offers; hidden machinery categories stay out. */
export default defineEventHandler(() => listNotificationCategories())
