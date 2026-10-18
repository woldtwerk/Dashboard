import { tool } from 'ai'
import type { ToolSet } from 'ai'
import type { DomainTool, ToolContext } from '../../../core/shared/types/tools'
import { runDomainTool } from '../../../core/server/utils/domain-tools'

/**
 * Adapts domain tools to AI SDK tools. Input validation, scope and logging stay
 * in the registry, so the assistant and MCP clients behave the same.
 */
export function toAiSdkTools(tools: DomainTool[], context: ToolContext): ToolSet {
  return Object.fromEntries(tools.map(domainTool => [domainTool.name, tool({
    description: domainTool.description,
    inputSchema: domainTool.input,
    execute: async input => await runDomainTool(domainTool.name, input, context)
  })]))
}
