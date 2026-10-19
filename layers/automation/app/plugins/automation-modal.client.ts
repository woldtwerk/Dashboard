import { effectScope } from 'vue'
import { modalFromEventResource, modalRef, parseModalRef } from '#layers/automation/shared/extractors'
import AutomationNotifyModal from '../components/automation/AutomationNotifyModal.vue'

/**
 * Opens a notification pop-up from the URL (`?automation-modal=<runId>.<nodeId>`)
 * on any page, and from the automation domain event an applied run publishes. The
 * URL is the state: the event only pushes the reference onto the current route,
 * and closing the modal removes it.
 *
 * `useDomainEvents` runs inside its own effect scope, so the subscription is not
 * torn down with whatever component happened to be mounted first.
 */
export default defineNuxtPlugin(() => {
  const route = useRoute()
  const router = useRouter()
  const overlay = useOverlay()
  const modal = overlay.create(AutomationNotifyModal)
  let showing: string | undefined

  function modalQuery(ref: string | undefined) {
    const query = { ...route.query }
    if (ref) {
      query['automation-modal'] = ref
    } else {
      delete query['automation-modal']
    }
    return router.replace({ query })
  }

  async function show(ref: string) {
    if (showing === ref) {
      return
    }
    const parsed = parseModalRef(ref)
    if (!parsed) {
      return
    }
    showing = ref
    await modal.open({ runId: parsed.runId, nodeId: parsed.nodeId })
    showing = undefined
    if (route.query['automation-modal'] === ref) {
      await modalQuery(undefined)
    }
  }

  const scope = effectScope(true)
  scope.run(() => {
    watch(() => route.query['automation-modal'], (value) => {
      const ref = typeof value === 'string' ? value : undefined
      if (ref && ref !== showing) {
        void show(ref)
      }
    }, { immediate: true })

    useDomainEvents({ domains: ['automation'] }, (event) => {
      const parsed = modalFromEventResource(event.resource)
      if (parsed) {
        void modalQuery(modalRef(parsed.runId, parsed.nodeId))
      }
    })
  })
})
