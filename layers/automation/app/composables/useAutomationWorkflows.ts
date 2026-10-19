import type { AutomationWorkflow } from '#layers/automation/shared/types/automation'

/**
 * The workflows the "Run workflow" item action offers. It loads lazily: the first
 * menu build starts one request, and automation domain events refresh the list so
 * a workflow created or deleted in another tab shows up without a reload. The
 * state lives in Nuxt's `useState`, not a module variable, so a server render and
 * the client share the same key.
 */
export function useAutomationWorkflows() {
  const workflows = useState<AutomationWorkflow[]>('automation:menu-workflows', () => [])
  const loaded = useState<boolean>('automation:menu-workflows:loaded', () => false)
  const loading = useState<boolean>('automation:menu-workflows:loading', () => false)

  async function load(): Promise<void> {
    if (loading.value) {
      return
    }

    loading.value = true
    try {
      workflows.value = await $fetch<AutomationWorkflow[]>('/api/automation/workflows')
      loaded.value = true
    } catch {
      // The menu falls back to "Create workflow…"; the next build retries
    } finally {
      loading.value = false
    }
  }

  /** Called while a menu is built; only the client fetches */
  function ensureLoaded(): void {
    if (import.meta.client && !loaded.value && !loading.value) {
      void load()
    }
  }

  return { workflows, loaded, loading, load, ensureLoaded }
}
