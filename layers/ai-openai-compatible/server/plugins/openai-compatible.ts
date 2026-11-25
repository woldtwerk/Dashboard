import { lumoTamerConnector, openAICompatibleConnector, openCodeConnector } from '../openai-compatible/connectors'
import { listOpenAICompatibleModels, listOpenCodeModels } from '../openai-compatible/models'
import { createGenericModel, createLumoModel, createOpenCodeModel } from '../openai-compatible/provider'

export default defineNitroPlugin(() => {
  registerConnector(openCodeConnector)
  registerAiProvider(openCodeConnector.id, createOpenCodeModel, { listModels: listOpenCodeModels })

  registerConnector(lumoTamerConnector)
  registerAiProvider(lumoTamerConnector.id, createLumoModel, { listModels: listOpenAICompatibleModels })

  registerConnector(openAICompatibleConnector)
  registerAiProvider(openAICompatibleConnector.id, createGenericModel, { listModels: listOpenAICompatibleModels })
})
