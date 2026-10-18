import { registerItemAction } from '#layers/core/app/utils/item-actions'

/**
 * Offers "Create workflow…" on mail and documents items. The automation layer
 * owns the action; the mail and documents pages only render `ItemActionsMenu`.
 */
export default defineNuxtPlugin(() => {
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
})
