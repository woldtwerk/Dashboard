// Keeps the mail index current while nobody has the dashboard open. Every cluster
// worker runs this task; syncMailIfStale takes the per-service lock, so only one
// of them syncs a service.
export default defineTask({
  meta: {
    name: 'mail:sync',
    description: 'Sync stale mail services into the search index'
  },
  async run() {
    const result = await syncStaleServices({
      services: () => listServices('mail'),
      syncIfStale: syncMailIfStale,
      logger: service => useServiceLogger('mail', service)
    })

    return { result }
  }
})
