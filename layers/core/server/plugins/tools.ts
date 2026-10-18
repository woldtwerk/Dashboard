import { registerDomainTools } from '../utils/domain-tools'
import { coreTools } from '../tools'

// Cross-reference tools over the relation providers; core owns no service itself
export default defineNitroPlugin(() => {
  registerDomainTools(coreTools)
})
