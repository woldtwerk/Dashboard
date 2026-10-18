import { createError } from 'nuxt/server'
import type { DomainTool, ToolContext } from '../../shared/types/tools'
import { useServiceLogger } from './service-logger'

/**
 * The tools every domain registers at startup. Registration is per worker and
 * static — the registry holds no request state, so any cluster worker can serve
 * a call.
 */
const tools = new Map<string, DomainTool>()

export interface DomainToolFilter {
  /** `read` hides write tools; omit for every tool */
  scope?: 'read' | 'write'
  /** Only tools of these domains */
  domains?: string[]
}

/** Registers a layer's tools; a name may only be claimed once. */
export function registerDomainTools(registered: DomainTool[]): void {
  const seen = new Set<string>()

  for (const tool of registered) {
    if (tools.has(tool.name) || seen.has(tool.name)) {
      throw new Error(`A domain tool named "${tool.name}" is already registered`)
    }
    seen.add(tool.name)
  }

  for (const tool of registered) {
    tools.set(tool.name, tool)
  }
}

/** The tools a caller of this scope may see, in registration order. */
export function listDomainTools({ scope, domains }: DomainToolFilter = {}): DomainTool[] {
  return [...tools.values()].filter(tool =>
    (scope !== 'read' || !tool.writes)
    && (!domains || domains.includes(tool.domain))
  )
}

/**
 * Runs one tool: validates its input, enforces the write scope and logs the
 * call. Input values are deliberately never logged — mail and documents carry
 * private content.
 */
export async function runDomainTool(name: string, input: unknown, context: ToolContext): Promise<unknown> {
  const tool = tools.get(name)
  if (!tool) {
    throw createError({ status: 404, statusText: `Unknown tool "${name}"` })
  }

  const parsed = tool.input.safeParse(input)
  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: parsed.error.issues[0]?.message ?? `Invalid input for "${name}"`
    })
  }

  if (tool.writes && context.scope !== 'write') {
    throw createError({ status: 403, statusText: `The tool "${name}" needs write access` })
  }

  useServiceLogger(tool.domain).info('Tool called', { tool: tool.name, caller: context.caller })

  return await tool.execute(parsed.data, context)
}
