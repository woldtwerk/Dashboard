import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { DomainTool, ToolContext } from '../shared/types/tools'

const info = vi.hoisted(() => vi.fn())
vi.mock('../server/utils/service-logger', () => ({ useServiceLogger: () => ({ info }) }))

const { listDomainTools, registerDomainTools, runDomainTool } = await import('../server/utils/domain-tools')

const context: ToolContext = { scope: 'read', caller: 'test' }

function fakeTool(overrides: Partial<DomainTool> = {}): DomainTool {
  return {
    name: `fake_${Math.random().toString(36).slice(2)}`,
    domain: 'fake',
    description: 'A fake tool',
    input: z.object({ value: z.string().min(1) }),
    writes: false,
    execute: async input => ({ received: input }),
    ...overrides
  } as DomainTool
}

beforeEach(() => {
  info.mockClear()
})

describe('registerDomainTools', () => {
  it('refuses a duplicate name', () => {
    const tool = fakeTool({ name: 'duplicate_test' })
    registerDomainTools([tool])

    expect(() => registerDomainTools([{ ...tool, domain: 'other' }])).toThrow(/already registered/)
  })

  it('refuses a duplicate within the same batch', () => {
    const tool = fakeTool({ name: 'duplicate_batch' })

    expect(() => registerDomainTools([tool, { ...tool, domain: 'other' }])).toThrow(/already registered/)
    expect(listDomainTools({ domains: ['fake'] }).some(item => item.name === 'duplicate_batch')).toBe(false)
  })
})

describe('listDomainTools', () => {
  it('lists read tools without the write tools', () => {
    const read = fakeTool({ name: 'scope_read', domain: 'scope-test' })
    const write = fakeTool({ name: 'scope_write', domain: 'scope-test', writes: true })
    registerDomainTools([read, write])

    expect(listDomainTools({ domains: ['scope-test'] }).map(tool => tool.name)).toEqual(['scope_read', 'scope_write'])
    expect(listDomainTools({ scope: 'read', domains: ['scope-test'] }).map(tool => tool.name)).toEqual(['scope_read'])
    expect(listDomainTools({ scope: 'write', domains: ['scope-test'] }).map(tool => tool.name)).toEqual(['scope_read', 'scope_write'])
  })

  it('filters by domain', () => {
    registerDomainTools([
      fakeTool({ name: 'domain_a', domain: 'a' }),
      fakeTool({ name: 'domain_b', domain: 'b' })
    ])

    expect(listDomainTools({ domains: ['b'] }).map(tool => tool.name)).toEqual(['domain_b'])
  })
})

describe('runDomainTool', () => {
  it('validation failures are a 400 and never reach the tool', async () => {
    const execute = vi.fn()
    registerDomainTools([fakeTool({ name: 'validation_tool', execute })])

    await expect(runDomainTool('validation_tool', { value: '' }, context)).rejects.toMatchObject({ statusCode: 400 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a write tool without write scope', async () => {
    const execute = vi.fn()
    registerDomainTools([fakeTool({ name: 'write_tool', writes: true, execute })])

    await expect(runDomainTool('write_tool', { value: 'x' }, context)).rejects.toMatchObject({ statusCode: 403 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs a write tool with write scope', async () => {
    const execute = vi.fn(async () => 'changed')
    registerDomainTools([fakeTool({ name: 'write_allowed', writes: true, execute })])

    await expect(runDomainTool('write_allowed', { value: 'x' }, { scope: 'write', caller: 'token' })).resolves.toBe('changed')
  })

  it('logs the call without its input values', async () => {
    registerDomainTools([fakeTool({ name: 'logged_tool', domain: 'logging' })])

    await runDomainTool('logged_tool', { value: 'top-secret' }, { scope: 'read', caller: 'assistant' })

    expect(info).toHaveBeenCalledWith('Tool called', { tool: 'logged_tool', caller: 'assistant' })
    expect(JSON.stringify(info.mock.calls)).not.toContain('top-secret')
  })

  it('reports an unknown tool', async () => {
    await expect(runDomainTool('does_not_exist', {}, context)).rejects.toMatchObject({ statusCode: 404 })
  })
})
