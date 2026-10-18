import { entityKey, entityLink } from '../../../core/shared/entities'
import type { EntityRef } from '../../../core/shared/types/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { registerSearchProvider } from '../../../core/server/utils/search'
import { contactSubtitle, sortName } from '../../app/utils/contacts'

export default defineNitroPlugin(() => {
  registerSearchProvider({
    domain: 'contacts',
    label: 'Contacts',
    icon: 'i-lucide-users',
    async search(q, limit): Promise<SearchHit[]> {
      const contacts = await searchContacts(q, limit)

      return contacts.map((contact): SearchHit => {
        const ref: EntityRef = { type: 'contact', service: contact.service, id: contact.uid }

        return {
          ref: entityKey(ref),
          title: sortName(contact) || contact.name || contact.uid,
          subtitle: contactSubtitle(contact),
          to: entityLink(ref)
        }
      })
    }
  })
})
