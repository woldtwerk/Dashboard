import { createPaperlessConnector } from '../paperless/connector'
import { createPaperlessProvider } from '../paperless/provider'

export default defineNitroPlugin(() => {
  // NUXT_PAPERLESS_URL is the default base URL the wizard offers
  const connector = createPaperlessConnector({ defaultUrl: process.env.NUXT_PAPERLESS_URL ?? '' })

  registerConnector(connector)
  registerDocumentsProvider(connector.id, createPaperlessProvider)
})
