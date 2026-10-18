import { defineEventHandler } from 'nuxt/server'
import { listDomainTools } from '../../../../../core/server/utils/domain-tools'
import { assistantDomainInfos } from '../../../mail-ai/domains'

// The domains the assistant can read, for the settings switches. Write tools
// are never offered to the assistant, so only read tools are counted.
export default defineEventHandler(() => assistantDomainInfos(listDomainTools({ scope: 'read' })))
