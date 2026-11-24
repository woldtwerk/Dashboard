import { describe, expect, it } from 'vitest'
import { openCodeEndpoints, openCodePlanName, toOpenCodeAccountUsage } from '../shared/opencode-usage'

const service = { id: 'svc', name: 'OpenCode Go' }

describe('toOpenCodeAccountUsage', () => {
  it('reads the console meters, plan, currency and balance', () => {
    expect(toOpenCodeAccountUsage({
      service,
      status: {
        product: 'go',
        renewalCurrency: 'usd',
        access: {
          meters: {
            fiveHour: { usedMicroCents: 25_000_000, limitMicroCents: 100_000_000, resetsAt: '2024-01-01T17:00:00Z', status: 'ok' },
            week: { usedMicroCents: '150000000', limitMicroCents: '200000000', resetsAt: '2024-01-02T12:00:00Z', status: 'ok' },
            month: { usedMicroCents: '400000000', limitMicroCents: '400000000', resetsAt: '2024-02-01T12:00:00Z', status: 'rate-limited' }
          }
        }
      },
      billing: { balanceMicroCents: '1234567890' }
    })).toEqual({
      serviceId: 'svc',
      serviceName: 'OpenCode Go',
      plan: 'Go',
      currency: 'USD',
      balanceUsd: 12.3456789,
      meters: [
        { key: 'rolling', percent: 25, usedUsd: 0.25, limitUsd: 1, resetsAt: '2024-01-01T17:00:00Z', rateLimited: false },
        { key: 'weekly', percent: 75, usedUsd: 1.5, limitUsd: 2, resetsAt: '2024-01-02T12:00:00Z', rateLimited: false },
        { key: 'monthly', percent: 100, usedUsd: 4, limitUsd: 4, resetsAt: '2024-02-01T12:00:00Z', rateLimited: true }
      ]
    })
  })

  it('falls back to the documented percentages when there is no console access', () => {
    expect(toOpenCodeAccountUsage({
      service,
      status: { product: 'go-plus', access: null },
      usage: {
        usage: {
          rolling: { percent: 10, resetsAt: '2024-01-01T17:00:00Z', status: 'ok' },
          weekly: { percent: 20, status: 'rate-limited' },
          monthly: { percent: 30, resetsAt: '2024-02-01T12:00:00Z', status: 'ok' }
        }
      }
    })).toEqual({
      serviceId: 'svc',
      serviceName: 'OpenCode Go',
      plan: 'Go Plus',
      meters: [
        { key: 'rolling', percent: 10, resetsAt: '2024-01-01T17:00:00Z', rateLimited: false },
        { key: 'weekly', percent: 20, rateLimited: true },
        { key: 'monthly', percent: 30, resetsAt: '2024-02-01T12:00:00Z', rateLimited: false }
      ]
    })
  })

  it('uses the usage percentage when a console meter has no usable amounts, keeping its reset', () => {
    expect(toOpenCodeAccountUsage({
      service,
      status: {
        access: {
          meters: {
            fiveHour: { limitMicroCents: '0', resetsAt: '2024-01-01T17:00:00Z' }
          }
        }
      },
      usage: {
        usage: {
          rolling: { percent: 42, resetsAt: '2024-01-01T18:00:00Z' }
        }
      }
    }).meters).toEqual([
      { key: 'rolling', percent: 42, resetsAt: '2024-01-01T17:00:00Z', rateLimited: false }
    ])
  })

  it('clamps the percentage to 0..100', () => {
    const { meters } = toOpenCodeAccountUsage({
      service,
      status: {
        access: {
          meters: {
            fiveHour: { usedMicroCents: 120_000_000, limitMicroCents: 100_000_000 }
          }
        }
      }
    })

    expect(meters[0]?.percent).toBe(100)
  })

  it('keeps a zero and a negative balance', () => {
    expect(toOpenCodeAccountUsage({ service, billing: { balanceMicroCents: '0' } }).balanceUsd).toBe(0)
    expect(toOpenCodeAccountUsage({ service, billing: { balanceMicroCents: -500_000_000 } }).balanceUsd).toBe(-5)
  })

  it('returns no meters and does not throw on unexpected shapes', () => {
    for (const value of [null, [], 'nope', {}, { access: 'x' }, { access: { meters: [] } }]) {
      expect(toOpenCodeAccountUsage({ service, status: value, billing: value, usage: value }).meters).toEqual([])
    }
  })
})

describe('openCodePlanName', () => {
  it('maps the products', () => {
    expect(openCodePlanName('go')).toBe('Go')
    expect(openCodePlanName('go-plus')).toBe('Go Plus')
    expect(openCodePlanName('go-teams')).toBe('Go Teams')
    expect(openCodePlanName('go-enterprise')).toBe('go-enterprise')
    expect(openCodePlanName(undefined)).toBeUndefined()
  })
})

describe('openCodeEndpoints', () => {
  it('uses the origin for the console endpoints and adds the usage fallback for Go', () => {
    expect(openCodeEndpoints('https://opencode.ai/inference/go/openai/v1')).toEqual({
      status: 'https://opencode.ai/console/api/go/status',
      billing: 'https://opencode.ai/console/api/billing/status',
      usage: 'https://opencode.ai/inference/go/v1/usage'
    })
  })

  it('has no usage fallback for a Zen base', () => {
    expect(openCodeEndpoints('https://opencode.ai/inference/openai/v1')).toEqual({
      status: 'https://opencode.ai/console/api/go/status',
      billing: 'https://opencode.ai/console/api/billing/status'
    })
  })

  it('throws on an invalid base URL', () => {
    expect(() => openCodeEndpoints('not a url')).toThrow()
  })
})
