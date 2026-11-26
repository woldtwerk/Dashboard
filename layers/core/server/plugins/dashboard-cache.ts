// A `changed` or `synced` event clears the domain's cached metrics and series and marks the
// service's cached status stale, so the next request shows fresh values instead of ones
// cached up to two minutes ago. Every cluster worker receives the event (Redis), so each
// invalidates the shared cache; the invalidation is idempotent.
export default defineNitroPlugin(() => {
  useDomainEventBus().subscribe((event) => {
    if (event.type === 'changed' || event.type === 'synced') {
      invalidateDashboardDomain(event.domain).catch(() => {})
    }
    if (event.type === 'changed' || event.type === 'synced' || event.type === 'sync-failed') {
      invalidateDashboardStatus(event.service).catch(() => {})
    }
  })
})
