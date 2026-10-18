import type { AiModelInfo, AiModelSelection, AiServiceModels } from './types/ai'

/** A model option; its select value is the `serviceId:modelId` pair stored in the URL. */
export interface AiModelOption {
  label: string
  value: string
  serviceId: string
  modelId: string
}

/** A heading in the model select, used when several services are set up. */
export interface AiModelGroupLabel {
  type: 'label'
  label: string
}

export type AiModelSelectItem = AiModelOption | AiModelGroupLabel

/** Reads `serviceId:modelId` from the `model` query param; undefined when malformed. */
export function parseModelParam(value: unknown): AiModelSelection | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) {
    return undefined
  }
  return { serviceId: value.slice(0, separator), modelId: value.slice(separator + 1) }
}

/** Serializes a selection for the `model` query param. */
export function serializeModelParam(selection?: AiModelSelection): string | undefined {
  return selection ? `${selection.serviceId}:${selection.modelId}` : undefined
}

/** Whether a requested model may be used: a listed one, or the service's configured model. */
export function isAiModelAllowed(requested: string, defaultModel: string, models: AiModelInfo[]): boolean {
  return requested === defaultModel || models.some(model => model.id === requested)
}

/**
 * The selection the URL resolves to. An unknown service or model is not an error:
 * it falls back to the first service's configured model.
 */
export function resolveModelSelection(services: AiServiceModels[], requested?: AiModelSelection): AiModelSelection | undefined {
  const service = requested && services.find(item => item.service.id === requested.serviceId)
  if (service && isAiModelAllowed(requested!.modelId, service.defaultModel, service.models)) {
    return { serviceId: service.service.id, modelId: requested!.modelId }
  }
  const first = services[0]
  return first ? { serviceId: first.service.id, modelId: first.defaultModel } : undefined
}

/** Select items, grouped by service when there are several (group label = service name). */
export function buildModelChoices(services: AiServiceModels[]): AiModelSelectItem[][] {
  const grouped = services.length > 1
  return services
    .filter(service => service.models.length > 0)
    .map((service) => {
      const options: AiModelOption[] = service.models.map(model => ({
        label: model.label,
        value: `${service.service.id}:${model.id}`,
        serviceId: service.service.id,
        modelId: model.id
      }))
      return grouped ? [{ type: 'label' as const, label: service.service.name }, ...options] : options
    })
}
