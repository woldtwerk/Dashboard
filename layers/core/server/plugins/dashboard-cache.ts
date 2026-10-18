// A `changed` or `synced` event clears the domain's cached metrics and series, so the
// next request shows the fresh value instead of one cached up to two minutes ago.
// Every cluster worker receives the event (Redis), so each invalidates the shared
// cache; the invalidation is idempotent.
export default defineNitroPlugin(() => {
  useDomainEventBus().subscribe((event) => {
    if (event.type === 'changed' || event.type === 'synced') {
      invalidateDashboardDomain(event.domain).catch(() => {})
    }
  })
})
