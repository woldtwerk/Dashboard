import type { DomainTool } from '../../../core/shared/types/tools'
import type { AssistantDomainInfo } from '../../shared/types/assistant'

/** Human labels for the domains the assistant can read. */
export const ASSISTANT_DOMAIN_LABELS: Record<string, string> = {
  mail: 'Mail',
  calendar: 'Calendar',
  contacts: 'Contacts',
  documents: 'Documents',
  drive: 'Drive',
  core: 'Cross references (people, related items, graph)'
}

/** The order the settings list shows the domains in; unknown domains follow. */
const DOMAIN_ORDER = ['mail', 'calendar', 'contacts', 'documents', 'drive', 'core']

/** Every domain that has read tools, with its label and tool count. */
export function assistantDomainInfos(tools: DomainTool[]): AssistantDomainInfo[] {
  const counts = new Map<string, number>()
  for (const tool of tools) {
    counts.set(tool.domain, (counts.get(tool.domain) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([domain, toolCount]) => ({
      domain,
      label: ASSISTANT_DOMAIN_LABELS[domain] ?? domain,
      toolCount
    }))
    .sort((a, b) => {
      const rank = (domain: string) => {
        const index = DOMAIN_ORDER.indexOf(domain)
        return index < 0 ? DOMAIN_ORDER.length : index
      }
      return rank(a.domain) - rank(b.domain)
    })
}
