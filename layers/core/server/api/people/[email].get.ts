import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { normalizeEmail } from '../../../shared/entities'

// Everything the providers know about one address; 404 when nobody knows it
export default defineEventHandler(async (event) => {
  const email = normalizeEmail(getRouterParam(event, 'email'))

  if (!email) {
    throw createError({ status: 400, statusText: 'Malformed email address' })
  }

  const person = await resolvePerson(email)
  if (!person) {
    throw createError({ status: 404, statusText: 'Unknown person' })
  }

  return person
})
