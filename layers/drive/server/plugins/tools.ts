import { registerDomainTools } from '../../../core/server/utils/domain-tools'
import { driveTools } from '../tools'

// Drive tools call the registered drive provider directly
export default defineNitroPlugin(() => {
  registerDomainTools(driveTools)
})
