import type { AutomationRun } from '#layers/automation/shared/types/automation'

/**
 * The activity feed the Workflows and Activity sections share. One `key` keeps it
 * to a single request per page load, whichever page asks for it first.
 */
export function useAutomationRuns() {
  const { data: runs, refresh } = useFetch<AutomationRun[]>('/api/automation/runs', {
    key: 'automation-runs',
    query: { limit: 100 },
    default: () => []
  })

  return { runs, refresh }
}
