import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getMethod, getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler } from 'nuxt/server'
import packageJson from '../../../../package.json'
import { authenticateMcpToken } from '../utils/mcp-auth'
import { listDomainTools, runDomainTool } from '../utils/domain-tools'
import { isAllowedMcpOrigin, requestOrigin } from '../utils/mcp-origin'

/**
 * Stateless MCP endpoint. Every request gets its own server and transport, so
 * no session lives in a worker's memory and any cluster worker can serve the
 * next request.
 */
export default defineEventHandler(async (event) => {
  // Nuxt's RequestEvent is narrower than h3's H3Event; the Node objects live on the h3 one
  const h3Event = event as unknown as H3Event

  if (getMethod(h3Event) !== 'POST') {
    setResponseStatus(h3Event, 405)
    setResponseHeader(h3Event, 'Allow', 'POST')

    return { error: 'Method not allowed' }
  }

  const ownOrigin = requestOrigin(
    getRequestHeader(h3Event, 'host'),
    getRequestHeader(h3Event, 'x-forwarded-proto'),
    !!h3Event.node.req.socket && !!(h3Event.node.req.socket as { encrypted?: boolean }).encrypted
  )

  if (!isAllowedMcpOrigin(getRequestHeader(h3Event, 'origin'), ownOrigin)) {
    setResponseStatus(h3Event, 403)
    return { error: 'Origin not allowed' }
  }

  const token = await authenticateMcpToken(getRequestHeader(h3Event, 'authorization'))
  if (!token) {
    setResponseStatus(h3Event, 401)
    setResponseHeader(h3Event, 'WWW-Authenticate', 'Bearer')

    return { error: 'Unauthorized' }
  }

  const server = new McpServer({ name: 'allmight', version: packageJson.version })

  for (const tool of listDomainTools({ scope: token.scope })) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.input,
      annotations: {
        readOnlyHint: !tool.writes,
        destructiveHint: tool.writes
      }
    }, async (input) => {
      const result = await runDomainTool(tool.name, input, { scope: token.scope, caller: token.name })

      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    })
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  h3Event.node.res.on('close', () => {
    void transport.close()
    void server.close()
  })

  await server.connect(transport)
  await transport.handleRequest(h3Event.node.req, h3Event.node.res)

  // The transport owns the response (including SSE); h3 must not write again
  const handledEvent = h3Event as unknown as { handled: boolean }
  handledEvent.handled = true
  return null
})
