import { describe, expect, it } from 'vitest'
import { dependenciesReady, withCurrentOption } from '../app/utils/setup'
import type { SetupField } from '../shared/types/setup'

const field: SetupField = {
  name: 'model',
  label: 'Model',
  type: 'select',
  dynamic: true,
  dependsOn: ['baseUrl', 'apiKey']
}

describe('dependenciesReady', () => {
  it('needs every dependency filled', () => {
    expect(dependenciesReady(field, { baseUrl: 'https://api.example.com/v1' })).toBe(false)
    expect(dependenciesReady(field, { baseUrl: 'https://api.example.com/v1', apiKey: 'key' })).toBe(true)
  })

  it('counts a stored secret as filled', () => {
    expect(dependenciesReady(field, { baseUrl: 'https://api.example.com/v1' }, ['apiKey'])).toBe(true)
  })

  it('treats an empty value as missing', () => {
    expect(dependenciesReady(field, { baseUrl: '', apiKey: 'key' })).toBe(false)
  })

  it('is ready without dependencies', () => {
    expect(dependenciesReady({ ...field, dependsOn: undefined }, {})).toBe(true)
  })
})

describe('withCurrentOption', () => {
  const options = [{ label: 'DeepSeek', value: 'deepseek' }, { label: 'GLM', value: 'glm' }]

  it('prepends the current value when the list lacks it', () => {
    expect(withCurrentOption(options, 'custom')).toEqual([
      { label: 'custom', value: 'custom' },
      ...options
    ])
  })

  it('leaves the list as it is when it contains the value', () => {
    expect(withCurrentOption(options, 'deepseek')).toEqual(options)
  })

  it('ignores an empty value', () => {
    expect(withCurrentOption(options, undefined)).toEqual(options)
    expect(withCurrentOption(options, '')).toEqual(options)
  })
})
