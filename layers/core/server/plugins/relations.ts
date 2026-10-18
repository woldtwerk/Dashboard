import { invalidateRelationDomain } from '../utils/relations'

// A domain's `changed` event drops the relations it contributed, so a mail the
// sync just added shows up on the next request instead of up to a minute later.
// Every cluster worker receives the event; removal is idempotent.
export default defineNitroPlugin(() => {
  useDomainEventBus().subscribe((event) => {
    if (event.type === 'changed') {
      invalidateRelationDomain(event.domain).catch(() => {})
    }
  })
})
