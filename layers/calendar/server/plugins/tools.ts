import { registerDomainTools } from '../../../core/server/utils/domain-tools'
import { calendarTools } from '../tools'

// Calendar tools reuse the CalDAV provider and the cache refresh helpers
export default defineNitroPlugin(() => {
  registerDomainTools(calendarTools)
})
