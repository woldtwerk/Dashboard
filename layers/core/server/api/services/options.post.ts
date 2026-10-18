import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import type { SetupValues } from '../../../shared/types/setup'

const OPTIONS_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Loading the options took too long')), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Options of a dynamic select field, e.g. the models an endpoint offers */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    connector: z.string(),
    service: z.string().optional(),
    field: z.string(),
    values: z.record(z.string(), z.unknown())
  }))
  const connector = getConnector(body.connector)
  const field = connector.wizard.steps.flatMap(step => step.fields ?? []).find(item => item.name === body.field)

  if (!field || field.type !== 'select' || !field.dynamic || !connector.fieldOptions) {
    throw createError({ status: 404, statusText: `Unknown dynamic field "${body.field}"` })
  }

  const service = body.service ? await getService(body.service) : undefined
  const values = mergeStoredSecrets(connector, body.values as SetupValues, service)

  try {
    return await withTimeout(connector.fieldOptions(field.name, values), OPTIONS_TIMEOUT_MS)
  } catch (error) {
    // The endpoint URL and key must not reach the client
    throw createError({
      status: 502,
      statusText: safeErrorMessage(error, 'The options could not be loaded'),
      cause: error
    })
  }
})
