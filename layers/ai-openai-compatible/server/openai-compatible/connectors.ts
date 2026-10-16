import { generateText } from 'ai'
import { createError } from 'nuxt/server'
import type { AiModel } from '../../../ai/server/utils/ai'
import type { Connector } from '../../../core/server/utils/services'
import type { SetupField } from '../../../core/shared/types/setup'
import { createGenericModel, createOpenCodeModel } from './provider'

/** A tiny completion proves URL, key and model before the service is saved */
async function testModel({ model, headers }: AiModel) {
  try {
    await generateText({ model, headers, prompt: 'Reply with OK.', maxOutputTokens: 16 })
  } catch (error) {
    const { statusCode, message } = error as { statusCode?: number, message?: string }
    throw createError({
      status: 502,
      statusText: statusCode === 401 || statusCode === 403
        ? 'The API key was rejected'
        : `The model could not be reached${statusCode ? ` (HTTP ${statusCode})` : ''}: ${message?.slice(0, 120) ?? 'unknown error'}`,
      cause: error
    })
  }
}

const structuredOutputsField: SetupField = {
  name: 'structuredOutputs',
  label: 'Structured outputs',
  description: 'Use the JSON schema mode of the API for filters. Turn off if the model rejects it.',
  type: 'switch',
  default: true
}

export const openCodeConnector: Connector = {
  id: 'opencode',
  domain: 'ai',
  title: 'OpenCode',
  description: 'Open models via OpenCode Go (subscription) or Zen (pay as you go).',
  icon: 'i-lucide-sparkles',

  wizard: {
    // A stored key is never sent to another endpoint
    bindSecretsTo: ['baseUrl'],
    steps: [{
      id: 'about',
      title: 'OpenCode',
      description: 'Plan and data',
      icon: 'i-lucide-info',
      intro: 'OpenCode is an external service. Questions to the assistant and excerpts of the mails it finds are sent to it.',
      instructions: [
        'OpenCode Go is meant for coding agents; check whether your use is covered by its terms. Zen (pay as you go) is meant for apps.',
        'Some models may keep or train on inputs. Get approval before using it with personal or customer data.',
        'Create an API key in your OpenCode account.'
      ],
      links: [
        { label: 'OpenCode Go', to: 'https://opencode.ai/docs/go/' },
        { label: 'OpenCode Zen', to: 'https://opencode.ai/docs/zen/' }
      ]
    }, {
      id: 'model',
      title: 'Model',
      description: 'Endpoint and key',
      icon: 'i-lucide-key-round',
      fields: [
        { name: 'baseUrl', label: 'API base URL', description: 'OpenCode Go by default; use the Zen URL from its docs for pay as you go.', type: 'text', required: true, default: 'https://opencode.ai/inference/go/openai/v1' },
        { name: 'apiKey', label: 'API key', type: 'password', required: true, secret: true },
        { name: 'model', label: 'Model', description: 'A chat completions model with tool calling, e.g. deepseek-v4.1-flash, glm-5.3, kimi-k3.', type: 'text', required: true, default: 'deepseek-v4.1-flash' },
        structuredOutputsField
      ]
    }]
  },

  test: values => testModel(createOpenCodeModel(values, { session: 'allmight-setup-test' }))
}

export const openAICompatibleConnector: Connector = {
  id: 'openai-compatible',
  domain: 'ai',
  title: 'OpenAI-compatible API',
  description: 'Any chat completions endpoint, e.g. a local Ollama or LM Studio.',
  icon: 'i-lucide-bot',

  wizard: {
    bindSecretsTo: ['baseUrl'],
    steps: [{
      id: 'model',
      title: 'Model',
      description: 'Endpoint and key',
      icon: 'i-lucide-key-round',
      intro: 'A local model (e.g. Ollama) keeps your mail on your machine. From inside DDEV, reach a model on your host via http://host.docker.internal:11434/v1.',
      fields: [
        { name: 'baseUrl', label: 'API base URL', type: 'text', required: true, placeholder: 'http://host.docker.internal:11434/v1' },
        { name: 'apiKey', label: 'API key', description: 'Leave empty if the endpoint needs none.', type: 'password', secret: true },
        { name: 'model', label: 'Model', description: 'Needs tool calling for the assistant.', type: 'text', required: true, placeholder: 'qwen3:8b' },
        { ...structuredOutputsField, default: false }
      ]
    }]
  },

  validate(values) {
    try {
      const url = new URL(String(values.baseUrl))
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'The base URL must use http or https'
      }
    } catch {
      return 'The base URL is not a valid URL'
    }
  },

  test: values => testModel(createGenericModel(values))
}
