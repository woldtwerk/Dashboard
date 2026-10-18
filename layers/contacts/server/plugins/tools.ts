import { registerDomainTools } from '../../../core/server/utils/domain-tools'
import { contactsTools } from '../tools'

// Contacts tools use the CardDAV provider directly
export default defineNitroPlugin(() => {
  registerDomainTools(contactsTools)
})
