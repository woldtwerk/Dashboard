// Keeps the contact cache current while nobody has the dashboard open. Every
// cluster worker runs this task; syncContactsIfStale takes the per-service lock,
// so only one of them syncs a service.
export default defineTask({
  meta: {
    name: 'contacts:sync',
    description: 'Sync stale contacts services into the card cache'
  },
  async run() {
    const result = await syncStaleServices({
      services: () => listServices('contacts'),
      syncIfStale: syncContactsIfStale,
      logger: service => useServiceLogger('contacts', service)
    })

    return { result }
  }
})
