import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const body = await readValidatedBody(event, documentsShareLinkBodySchema)

  return (await useDocumentsProvider(service)).createShareLink(id, {
    expiration: body.expiration ?? null,
    fileVersion: body.fileVersion
  })
})
