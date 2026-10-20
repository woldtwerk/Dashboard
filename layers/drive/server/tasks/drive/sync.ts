import { DRIVE_CRAWL_BUDGET_MS } from '../../../shared/sync-schedule'
import { driveListingCache } from '../../utils/drive-cache'
import { syncDriveIfStale } from '../../utils/drive-sync'

// Keeps the drive cache warm while nobody has the dashboard open. Every cluster
// worker runs this task, but one global crawl lease means only one of them walks
// the tree; the budget is shared by every service in the run because all of them
// use the same CLI container and its single lock.
export default defineTask({
  meta: {
    name: 'drive:sync',
    description: 'Crawl the drive tree into the cache'
  },
  async run() {
    const deadline = Date.now() + DRIVE_CRAWL_BUDGET_MS

    const result = await syncStaleServices({
      services: () => listServices('drive'),
      syncIfStale: service => syncDriveIfStale(service, driveListingCache, deadline),
      logger: service => useServiceLogger('drive', service)
    })

    return { result }
  }
})
