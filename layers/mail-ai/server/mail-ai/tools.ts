import { tool } from 'ai'
import type { JSONValue, ToolSet } from 'ai'
import type { DomainTool, ToolContext, ToolSource } from '../../../core/shared/types/tools'
import { runDomainTool } from '../../../core/server/utils/domain-tools'

/** More than this many source cards are never sent to the UI in one tool call. */
export const TOOL_SOURCE_LIMIT = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Puts the domain's source items into the tool output the UI receives. The
 * model gets the plain output back via `toModelOutput`, so the cards never
 * travel to the provider.
 */
export function toolOutputWithSources(output: unknown, sources: ToolSource[] | undefined): unknown {
  if (!sources?.length) {
    return output
  }

  const limited = sources.slice(0, TOOL_SOURCE_LIMIT)
  return isRecord(output) ? { ...output, sources: limited } : { result: output, sources: limited }
}

/** The output a tool without cards uses, and the shape the model sees. */
export function toolModelOutput(output: unknown): unknown {
  if (!isRecord(output) || !('sources' in output)) {
    return output
  }

  const { sources: _sources, ...rest } = output
  return 'result' in rest && Object.keys(rest).length === 1 ? rest.result : rest
}

/**
 * Adapts domain tools to AI SDK tools. Input validation, scope and logging stay
 * in the registry, so the assistant and MCP clients behave the same.
 */
export function toAiSdkTools(tools: DomainTool[], context: ToolContext): ToolSet {
  return Object.fromEntries(tools.map(domainTool => [domainTool.name, tool({
    description: domainTool.description,
    inputSchema: domainTool.input,
    execute: async (input) => {
      const output = await runDomainTool(domainTool.name, input, context)
      return toolOutputWithSources(output, domainTool.sources?.(output))
    },
    // Source cards are UI-only; the model receives the domain's own output
    toModelOutput: ({ output }) => ({ type: 'json', value: toolModelOutput(output) as JSONValue })
  })]))
}
