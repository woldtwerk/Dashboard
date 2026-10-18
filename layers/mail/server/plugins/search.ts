import { entityKey, entityLink } from '../../../core/shared/entities'
import type { EntityRef } from '../../../core/shared/types/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { registerSearchProvider } from '../../../core/server/utils/search'
import { formatAddresses } from '../../shared/mail-source'

export default defineNitroPlugin(() => {
  registerSearchProvider({
    domain: 'mail',
    label: 'Mail',
    icon: 'i-lucide-mail',
    async search(q, limit): Promise<SearchHit[]> {
      const index = useMailSearchIndex()
      if (!index) {
        // Without a search index there is no cross-folder full text
        return []
      }

      const services = (await listServices('mail')).map(item => item.id)
      if (!services.length) {
        return []
      }

      const mails = await index.search({ services, search: { text: q }, limit })

      return mails.map((mail): SearchHit => {
        const ref: EntityRef = { type: 'mail', service: mail.service, id: `${mail.mailbox}/${mail.uid}` }

        return {
          ref: entityKey(ref),
          title: mail.subject || '(no subject)',
          titleHighlight: mail.subjectHighlight,
          snippet: mail.snippet,
          subtitle: [formatAddresses(mail.from), mail.mailbox].filter(Boolean).join(' · '),
          to: entityLink(ref),
          date: mail.date
        }
      })
    }
  })
})
