import { registerDomainTools } from '../../../core/server/utils/domain-tools'
import { documentsTools } from '../tools'

// Documents tools call the registered archive provider directly
export default defineNitroPlugin(() => {
  registerDomainTools(documentsTools)
})
