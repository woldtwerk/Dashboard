import { entityKey, entityLink } from '../../../core/shared/entities'
import type { EntityRef } from '../../../core/shared/types/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { registerSearchProvider } from '../../../core/server/utils/search'
import { searchParentLabel } from '../drive-sync/search'
import { searchDriveEntries } from '../utils/drive-search'

export default defineNitroPlugin(() => {
  registerSearchProvider({
    domain: 'drive',
    label: 'Drive',
    icon: 'i-lucide-hard-drive',
    async search(q, limit): Promise<SearchHit[]> {
      const services = (await listServices('drive')).map(service => service.id)
      const entries = await searchDriveEntries(services, q, limit)

      return entries.map((entry): SearchHit => {
        const ref: EntityRef = { type: 'file', service: entry.service, id: entry.path }

        return {
          ref: entityKey(ref),
          title: entry.name,
          subtitle: searchParentLabel(entry.parent),
          to: entityLink(ref),
          date: entry.modified
        }
      })
    }
  })
})
