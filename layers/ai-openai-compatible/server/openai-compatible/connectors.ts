import { generateText } from 'ai'
import { createError } from 'nuxt/server'
import type { AiModel } from '../../../ai/server/utils/ai'
import type { Connector } from '../../../core/server/utils/services'
import type { SetupField } from '../../../core/shared/types/setup'
import { listOpenAICompatibleModels, listOpenCodeModels } from './models'
import { createGenericModel, createLumoModel, createOpenCodeModel } from './provider'

/** A tiny completion proves URL, key and model before the service is saved */
async function testModel({ model, headers }: AiModel, signal?: AbortSignal) {
  try {
    await generateText({ model, headers, prompt: 'Reply with OK.', maxOutputTokens: 16, abortSignal: signal })
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
        { name: 'model', label: 'Model', description: 'A chat completions model with tool calling, e.g. deepseek-v4.1-flash, glm-5.3, kimi-k3.', type: 'select', dynamic: true, dependsOn: ['baseUrl', 'apiKey'], allowCustom: true, required: true, default: 'deepseek-v4.1-flash' },
        structuredOutputsField
      ]
    }]
  },

  async fieldOptions(field, values) {
    if (field !== 'model') {
      return []
    }
    const models = await listOpenCodeModels(values)
    return models.map(model => ({ label: model.label, value: model.id, description: model.id }))
  },

  test: async values => testModel(await createOpenCodeModel(values, { session: 'allmight-setup-test' }))
}

const lumoModelLabels: Record<string, string> = {
  'lumo': 'Lumo (auto)',
  'lumo-lite': 'Lumo Lite',
  'lumo-max': 'Lumo Max'
}

/** Names the three Proton Lumo tiers; another id is shown as it is */
export function lumoModelLabel(id: string): string {
  return lumoModelLabels[id] ?? id
}

export const lumoTamerConnector: Connector = {
  id: 'lumo-tamer',
  domain: 'ai',
  title: 'Lumo (Proton)',
  description: 'Proton Lumo through lumo-tamer, an unofficial OpenAI-compatible local proxy.',
  icon: 'i-lucide-sun-moon',

  wizard: {
    // A stored key is never sent to another endpoint
    bindSecretsTo: ['baseUrl'],
    steps: [{
      id: 'signin',
      title: 'Sign in',
      description: 'Proton account',
      icon: 'i-lucide-log-in',
      intro: 'Lumo is Proton\'s assistant, reached through lumo-tamer, an unofficial local proxy. Your prompts and excerpts of the mail it finds go to Proton. The proxy must stay on your local network. This is an unofficial project, so check Proton\'s terms before using it. Tools are emulated, so answers may come back without data.',
      component: 'LumoTamerLogin',
      fields: [
        { name: 'baseUrl', label: 'Proxy base URL', description: 'Where lumo-tamer listens, e.g. http://tamer:3003/v1.', type: 'text', required: true },
        { name: 'apiKey', label: 'Proxy API key', type: 'password', required: true, secret: true },
        { name: 'email', label: 'Proton address', description: 'Only to show which account is signed in.', type: 'text' }
      ]
    }, {
      id: 'model',
      title: 'Model',
      description: 'Answer model',
      icon: 'i-lucide-cpu',
      fields: [
        { name: 'model', label: 'Model', description: 'Lumo picks a tier automatically, Lumo Lite is the fast tier and Lumo Max the strongest. The proxy needs server.customTools.enabled: true for the assistant\'s tools.', type: 'select', dynamic: true, dependsOn: ['baseUrl', 'apiKey'], allowCustom: true, required: true, default: 'lumo' }
      ]
    }]
  },

  async fieldOptions(field, values) {
    if (field !== 'model') {
      return []
    }
    const models = await listOpenAICompatibleModels(values)
    return models.map(model => ({ label: lumoModelLabel(model.id), value: model.id, description: model.id }))
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

  // The proxy serializes requests, so the default timeout is too tight for a test call
  test: values => testModel(createLumoModel(values), AbortSignal.timeout(30_000))
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
        { name: 'model', label: 'Model', description: 'Needs tool calling for the assistant.', type: 'select', dynamic: true, dependsOn: ['baseUrl'], allowCustom: true, required: true, placeholder: 'qwen3:8b' },
        { ...structuredOutputsField, default: false }
      ]
    }]
  },

  async fieldOptions(field, values) {
    if (field !== 'model') {
      return []
    }
    const models = await listOpenAICompatibleModels(values)
    return models.map(model => ({ label: model.id, value: model.id }))
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
