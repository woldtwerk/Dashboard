/** One model an AI service offers, as shown in the model select. */
export interface AiModelInfo {
  id: string
  label: string
}

/** The model picked in the URL, `?model=<serviceId>:<modelId>`. */
export interface AiModelSelection {
  serviceId: string
  modelId: string
}

/** The models of one configured AI service, the shape of GET /api/ai/models. */
export interface AiServiceModels {
  service: { id: string, name: string }
  defaultModel: string
  models: AiModelInfo[]
  /** Why the provider could not list its models; the fallback is the configured model */
  error?: string
}
