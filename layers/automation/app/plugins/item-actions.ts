import { effectScope } from 'vue'
import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import { registerItemAction } from '#layers/core/app/utils/item-actions'
import type { AutomationWorkflow, WorkflowRunResult } from '#layers/automation/shared/types/automation'
import { formatWorkflowRunSummary, workflowActionLabel, workflowsForContexts } from '../utils/workflow-actions'

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const { statusMessage, message } = error as { statusMessage?: string, message?: string }
    return statusMessage || message || 'Unknown error'
  }
  return 'Unknown error'
}

/**
 * Offers "Create workflow…" on mail and documents items, and "Run workflow" with
 * one submenu entry per applicable workflow. The automation layer owns both; the
 * mail and documents pages only render `ItemActionsMenu`. The workflow list loads
 * lazily the first time the submenu is built and follows automation domain events.
 */
export default defineNuxtPlugin(() => {
  const toast = useToast()
  const { workflows, loaded, load, ensureLoaded } = useAutomationWorkflows()

  /** POSTs the picked refs and reports the per-item outcome */
  async function runWorkflow(workflow: AutomationWorkflow, contexts: ItemActionContext[]) {
    const loadingToast = `automation-run:${workflow.id}`
    toast.add({
      id: loadingToast,
      title: `Running ${workflow.name}…`,
      icon: 'i-lucide-loader-circle',
      duration: 0
    })

    try {
      const { results } = await $fetch<WorkflowRunResult>(`/api/automation/workflows/${workflow.id}/run`, {
        method: 'POST',
        body: { refs: contexts.map(context => context.ref) }
      })
      toast.remove(loadingToast)

      const failed = results.filter(result => result.outcome === 'failed')
      const review = results.some(result => result.outcome === 'review')
      toast.add({
        title: `${workflow.name}: ${formatWorkflowRunSummary(results)}`,
        description: failed.find(result => result.error)?.error,
        color: failed.length === results.length ? 'error' : failed.length ? 'warning' : review ? 'info' : 'success',
        icon: failed.length ? 'i-lucide-circle-alert' : review ? 'i-lucide-user-round-check' : 'i-lucide-check',
        actions: [{
          label: 'Open activity',
          color: 'neutral',
          variant: 'link',
          onClick: () => void navigateTo('/automation/activity')
        }]
      })
    } catch (error) {
      toast.remove(loadingToast)
      toast.add({
        title: `Could not run ${workflow.name}`,
        description: errorMessage(error),
        color: 'error',
        icon: 'i-lucide-circle-alert'
      })
    }
  }

  registerItemAction({
    id: 'automation-create-workflow',
    label: 'Create workflow…',
    icon: 'i-lucide-workflow',
    domains: ['mail', 'documents'],
    order: 50,
    to: context => ({
      path: '/automation/new',
      query: { from: context.ref, service: context.service }
    })
  })

  registerItemAction({
    id: 'automation-run-workflow',
    label: 'Run workflow',
    icon: 'i-lucide-workflow',
    domains: ['mail', 'documents'],
    order: 40,
    multiple: true,
    children: (contexts) => {
      // Building the menu is the lazy trigger; the state re-renders once it arrives
      ensureLoaded()

      if (!loaded.value) {
        return [{ label: 'Loading workflows…', icon: 'i-lucide-loader-circle', disabled: true }]
      }

      const available = workflowsForContexts(workflows.value, contexts)
      if (!available.length) {
        const first = contexts[0]
        return [{
          label: 'Create workflow…',
          icon: 'i-lucide-plus',
          ...(first ? { to: { path: '/automation/new', query: { from: first.ref, service: first.service } } } : {})
        }]
      }

      return available.map(workflow => ({
        label: workflowActionLabel(workflow),
        icon: 'i-lucide-workflow',
        onSelect: () => void runWorkflow(workflow, contexts)
      }))
    }
  })

  if (import.meta.client) {
    // Its own scope so the subscription lives as long as the app, not a page
    const scope = effectScope(true)
    scope.run(() => {
      useDomainEvents({ domains: ['automation'] }, () => {
        if (loaded.value) {
          void load()
        }
      })
    })
  }
})
