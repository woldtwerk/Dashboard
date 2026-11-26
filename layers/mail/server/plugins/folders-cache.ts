// Folder lists are cached per service; a mail `changed` or `synced` event marks the
// service's entry stale so the next read revalidates. Every cluster worker receives
// the event (Redis), so each invalidates the shared cache; the invalidation is idempotent.

import { invalidateMailFolders } from '../utils/mail-folders-cache'

export default defineNitroPlugin(() => {
  useDomainEventBus().subscribe((event) => {
    if (event.domain === 'mail' && (event.type === 'changed' || event.type === 'synced')) {
      invalidateMailFolders(event.service).catch(() => {})
    }
  })
})
