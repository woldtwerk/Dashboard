// Keeps the event cache current while nobody has the dashboard open. Every cluster
// worker runs this task; syncCalendarIfStale takes the per-service lock, so only
// one of them syncs a service.
export default defineTask({
  meta: {
    name: 'calendar:sync',
    description: 'Sync stale calendar services into the event cache'
  },
  async run() {
    const result = await syncStaleServices({
      services: () => listServices('calendar'),
      syncIfStale: syncCalendarIfStale,
      logger: service => useServiceLogger('calendar', service)
    })

    return { result }
  }
})
