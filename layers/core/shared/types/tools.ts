import type { z } from 'zod'

/**
 * Contract for the domain tools the assistant and MCP clients call. A tool is
 * declared by its domain layer and executed by the registry; this file only
 * fixes the shape, the registry itself is planned:
 *
 * - `registerDomainTools(tools)` — a layer registers its `DomainTool`s at startup.
 * - `listDomainTools({ scope })` — the tools a caller may see; `write` includes `read`.
 * - `POST /mcp` — stateless streamable HTTP MCP endpoint, authenticated with a Bearer MCP token.
 * - `GET /api/entities/related?ref=<key>&limit=` → `RelatedGroup[]`
 * - `GET /api/entities/graph?ref=<key>&depth=1|2` → `EntityGraph`
 * - `GET /api/people/<email>` → `Person`
 */

export interface ToolContext {
  /** 'read' or 'write' — write tools only run with write scope */
  scope: 'read' | 'write'
  /** who called: 'assistant' or an MCP token name */
  caller: string
}

export interface DomainTool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** snake_case, unique across domains, e.g. `mail_search` */
  name: string
  domain: string
  description: string
  input: I
  /** true for tools that change data (MCP destructiveHint, needs write scope) */
  writes: boolean
  execute(input: z.infer<I>, context: ToolContext): Promise<unknown>
}
