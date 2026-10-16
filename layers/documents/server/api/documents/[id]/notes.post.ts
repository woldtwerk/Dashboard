import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const { note } = await readValidatedBody(event, documentsNoteBodySchema)

  return (await useDocumentsProvider(service)).addNote(id, note)
})
