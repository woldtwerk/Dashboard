import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { DomainTool } from '../shared/types/tools'
import { coreTools } from '../server/tools'
import { calendarTools } from '../../calendar/server/tools'
import { contactsTools } from '../../contacts/server/tools'
import { documentsTools } from '../../documents/server/tools'
import { driveTools } from '../../drive/server/tools'
import { mailTools } from '../../mail/server/tools'

vi.mock('../server/utils/service-logger', () => ({ useServiceLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }))

const { listDomainTools, registerDomainTools, runDomainTool } = await import('../server/utils/domain-tools')

const echo: DomainTool = {
  name: 'test_echo',
  domain: 'test',
  description: 'Echo a value back.',
  input: z.object({ value: z.string().describe('The value to echo') }),
  writes: false,
  execute: async input => ({ echoed: (input as { value: string }).value })
}

/** Builds the server the MCP route builds, over linked in-memory transports. */
async function connect(scope: 'read' | 'write') {
  const server = new McpServer({ name: 'allmight', version: '1.0.0' })

  for (const tool of listDomainTools({ scope })) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: !tool.writes, destructiveHint: tool.writes }
    }, async input => ({ content: [{ type: 'text' as const, text: JSON.stringify(await runDomainTool(tool.name, input, { scope, caller: 'test' })) }] }))
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  return client
}

registerDomainTools([...mailTools, ...calendarTools, ...contactsTools, ...driveTools, ...documentsTools, ...coreTools, echo])

describe('MCP tool exposure', () => {
  it('exposes every read tool with its description, input schema and annotations', async () => {
    const client = await connect('read')
    const { tools } = await client.listTools()
    const expected = listDomainTools({ scope: 'read' })

    expect(tools.map(tool => tool.name).sort()).toEqual(expected.map(tool => tool.name).sort())
    const search = tools.find(tool => tool.name === 'mail_search')!
    expect(search.description).toBeTruthy()
    expect(search.annotations?.readOnlyHint).toBe(true)
    expect((search.inputSchema as { type?: string }).type).toBe('object')
  })

  it('lists the core cross-reference tools for a read token', async () => {
    const client = await connect('read')
    const names = (await client.listTools()).tools.map(tool => tool.name)

    expect(names).toContain('get_related')
    expect(names).toContain('find_person')
    expect(names).toContain('get_graph')
    expect(names).toContain('list_known_people')
  })

  it('hides write tools from a read token and lists them for a write token', async () => {
    const read = await connect('read')
    const write = await connect('write')

    const readNames = (await read.listTools()).tools.map(tool => tool.name)
    const writeNames = (await write.listTools()).tools.map(tool => tool.name)

    expect(readNames).not.toContain('mail_move')
    expect(writeNames).toContain('mail_move')
    expect(writeNames.length).toBeGreaterThan(readNames.length)
  })

  it('returns a tool result as JSON text', async () => {
    const client = await connect('read')
    const result = await client.callTool({ name: 'test_echo', arguments: { value: 'hi' } })

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ echoed: 'hi' }) }])
  })
})
