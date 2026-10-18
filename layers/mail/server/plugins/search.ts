import { entityKey, entityLink } from '../../../core/shared/entities'
import type { EntityRef } from '../../../core/shared/types/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { isHighlighted } from '../../../core/shared/search-ranking'
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

      // The palette keeps the hybrid search but marks what it found: a hit whose
      // title, sender or body carries a highlight is a keyword match, everything
      // else came from the embeddings alone.
      const mails = await index.search({ services, search: { text: q }, limit, globalSearch: true })

      return mails.map((mail): SearchHit => {
        const ref: EntityRef = { type: 'mail', service: mail.service, id: `${mail.mailbox}/${mail.uid}` }
        const keyword = [mail.subjectHighlight, mail.fromHighlight, mail.snippet].some(isHighlighted)

        return {
          ref: entityKey(ref),
          title: mail.subject || '(no subject)',
          titleHighlight: mail.subjectHighlight,
          snippet: mail.snippet,
          subtitle: [formatAddresses(mail.from), mail.mailbox].filter(Boolean).join(' · '),
          subtitleHighlight: mail.fromHighlight
            ? [mail.fromHighlight, mail.mailbox].filter(Boolean).join(' · ')
            : undefined,
          match: keyword ? 'keyword' : 'semantic',
          providerScore: mail.rankingScore,
          to: entityLink(ref),
          date: mail.date
        }
      })
    }
  })
})
