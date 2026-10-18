import { describe, expect, it } from 'vitest'
import { mergeStoredSecrets } from '../server/utils/services'
import type { Connector, Service } from '../server/utils/services'

const connector: Connector = {
  id: 'demo',
  domain: 'ai',
  title: 'Demo',
  wizard: {
    bindSecretsTo: ['baseUrl'],
    steps: [{
      id: 'model',
      title: 'Model',
      fields: [
        { name: 'baseUrl', label: 'API base URL', type: 'text' },
        { name: 'apiKey', label: 'API key', type: 'password', secret: true },
        { name: 'model', label: 'Model', type: 'text' }
      ]
    }]
  }
}

const service: Service = {
  id: 'service-1',
  connector: 'demo',
  domain: 'ai',
  name: 'Demo',
  values: { baseUrl: 'https://api.example.com/v1', apiKey: 'stored-key', model: 'deepseek' }
}

describe('mergeStoredSecrets', () => {
  it('keeps the stored secret when the target is unchanged', () => {
    expect(mergeStoredSecrets(connector, { baseUrl: 'https://api.example.com/v1', apiKey: '' }, service))
      .toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: 'stored-key' })
  })

  it('drops the stored secret when the base URL changed', () => {
    expect(mergeStoredSecrets(connector, { baseUrl: 'https://other.example.com/v1', apiKey: '' }, service))
      .toEqual({ baseUrl: 'https://other.example.com/v1', apiKey: '' })
  })

  it('keeps a secret the user typed, even for another target', () => {
    expect(mergeStoredSecrets(connector, { baseUrl: 'https://other.example.com/v1', apiKey: 'new-key' }, service))
      .toEqual({ baseUrl: 'https://other.example.com/v1', apiKey: 'new-key' })
  })

  it('fills nothing without a stored service', () => {
    expect(mergeStoredSecrets(connector, { baseUrl: 'https://api.example.com/v1', apiKey: '' }))
      .toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
  })
})
