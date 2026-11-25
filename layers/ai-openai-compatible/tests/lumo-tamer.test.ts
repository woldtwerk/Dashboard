import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lumoModelLabel, lumoTamerConnector } from '../server/openai-compatible/connectors'
import type { SetupValues } from '../../core/shared/types/setup'

const lumoValues: SetupValues = {
  baseUrl: 'http://tamer:3003/v1',
  apiKey: 'secret-key',
  model: 'lumo'
}

let listed: unknown

beforeEach(() => {
  listed = { data: [{ id: 'lumo-max' }, { id: 'custom-model' }, { id: 'lumo' }] }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => listed })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lumoModelLabel', () => {
  it.each([
    ['lumo', 'Lumo (auto)'],
    ['lumo-lite', 'Lumo Lite'],
    ['lumo-max', 'Lumo Max'],
    ['other-model', 'other-model']
  ])('labels %s as %s', (id, label) => {
    expect(lumoModelLabel(id)).toBe(label)
  })
})

describe('lumoTamerConnector', () => {
  it('offers a dynamic model list that needs the endpoint and key', () => {
    const model = lumoTamerConnector.wizard.steps
      .find(step => step.id === 'model')
      ?.fields?.find(field => field.name === 'model')

    expect(model).toMatchObject({
      type: 'select',
      dynamic: true,
      dependsOn: ['baseUrl', 'apiKey'],
      default: 'lumo'
    })
  })

  it.each(['http://tamer:3003/v1', 'https://proxy.example/v1'])('accepts %s', (baseUrl) => {
    expect(lumoTamerConnector.validate?.({ baseUrl })).toBeUndefined()
  })

  it.each(['ftp://proxy.example/v1', 'not a url'])('rejects %s', (baseUrl) => {
    expect(lumoTamerConnector.validate?.({ baseUrl })).toBeTruthy()
  })

  it('relabels the models the proxy lists', async () => {
    await expect(lumoTamerConnector.fieldOptions!('model', lumoValues)).resolves.toEqual([
      { label: 'custom-model', value: 'custom-model', description: 'custom-model' },
      { label: 'Lumo (auto)', value: 'lumo', description: 'lumo' },
      { label: 'Lumo Max', value: 'lumo-max', description: 'lumo-max' }
    ])
  })

  it('knows no options for another field', async () => {
    await expect(lumoTamerConnector.fieldOptions!('baseUrl', lumoValues)).resolves.toEqual([])
  })
})
