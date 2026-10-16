import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, noteId } = await getValidatedQuery(event, documentsNoteQuerySchema)
  const id = documentsParamId(event)

  await (await useDocumentsProvider(service)).removeNote(id, noteId)

  return { ok: true }
})
