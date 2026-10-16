import { openAICompatibleConnector, openCodeConnector } from '../openai-compatible/connectors'
import { createGenericModel, createOpenCodeModel } from '../openai-compatible/provider'

export default defineNitroPlugin(() => {
  registerConnector(openCodeConnector)
  registerAiProvider(openCodeConnector.id, createOpenCodeModel)

  registerConnector(openAICompatibleConnector)
  registerAiProvider(openAICompatibleConnector.id, createGenericModel)
})
