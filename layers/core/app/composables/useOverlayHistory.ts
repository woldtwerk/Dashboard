import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { HistoryState } from 'vue-router'
import { overlayStackFromState, overlayStateFor } from '../utils/overlay-history'

let nextOverlayId = 0

/**
 * Ties a local open ref to browser history: opening pushes an entry for the
 * current page, closing through the ref goes back, and back/forward updates the
 * ref. An overlay already open on mount is left alone (it came from a link or a
 * deep link), as is a close when another overlay is still on top.
 */
export function useOverlayHistory(open: Ref<boolean>, id?: string): void {
  if (!import.meta.client) {
    return
  }

  const overlayId = id ?? `overlay-${++nextOverlayId}`
  const router = useRouter()
  const route = useRoute()
  let restoring = false

  watch(open, (isOpen) => {
    if (restoring) {
      return
    }

    const stack = overlayStackFromState(window.history.state)
    if (isOpen) {
      if (!stack.includes(overlayId)) {
        void router.push({
          path: route.path,
          query: route.query,
          hash: route.hash,
          force: true,
          state: overlayStateFor(stack, overlayId) as HistoryState
        })
      }
      return
    }

    if (stack[stack.length - 1] === overlayId) {
      void router.back()
    }
  })

  function onPopState() {
    const isOpen = overlayStackFromState(window.history.state).includes(overlayId)
    if (isOpen !== open.value) {
      restoring = true
      open.value = isOpen
      void nextTick(() => {
        restoring = false
      })
    }
  }

  onMounted(() => window.addEventListener('popstate', onPopState))
  onBeforeUnmount(() => window.removeEventListener('popstate', onPopState))
}
