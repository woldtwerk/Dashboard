import { registerDomainTools } from '../../../core/server/utils/domain-tools'
import { mailTools } from '../tools'

// Mail tools call the providers and the search index directly, never its HTTP API
export default defineNitroPlugin(() => {
  registerDomainTools(mailTools)
})
