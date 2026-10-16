import { createError, getRouterParam } from 'nuxt/server'

type Event = Parameters<typeof getRouterParam>[0]

/** A validated route id; never hand an arbitrary router param to a provider. */
export function documentsParamId(event: Event, name = 'id'): number {
  const result = documentsIdSchema.safeParse(getRouterParam(event, name))
  if (!result.success) {
    throw createError({ status: 400, statusText: `Invalid ${name}` })
  }
  return result.data
}
