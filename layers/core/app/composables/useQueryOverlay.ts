import type { HistoryState, LocationQueryRaw } from 'vue-router'
import {
  OVERLAY_STATE_KEY,
  overlayBaseFromState,
  overlayClosePlan,
  overlayOpenState,
  overlayQueryKey,
  overlayStackFromState
} from '../utils/overlay-history'

/**
 * Opens and closes overlays whose state lives in the URL query. Opening adds a
 * history entry unless this overlay is already open, in which case the current
 * entry is retargeted; closing goes back when we own the entry, and
 * otherwise clears the query in place for a deep-linked overlay.
 */
export function useQueryOverlay() {
  const router = useRouter()
  const route = useRoute()

  const filtered = (query: LocationQueryRaw): LocationQueryRaw => Object.fromEntries(
    Object.entries(query).filter(([, value]) => value)
  )

  function open(id: string, patch: LocationQueryRaw, alreadyOpen: boolean): void {
    if (!import.meta.client) {
      return
    }

    const query = filtered({ ...route.query, ...patch })

    if (alreadyOpen) {
      void router.replace({ query })
      return
    }

    const base = overlayQueryKey(filtered(route.query))
    void router.push({
      query,
      state: overlayOpenState(overlayStackFromState(window.history.state), id, base) as HistoryState
    })
  }

  function close(id: string, patch: LocationQueryRaw): void {
    if (!import.meta.client) {
      return
    }

    const query = filtered({ ...route.query, ...patch })
    const base = overlayBaseFromState(window.history.state)
    const changed = base !== undefined && overlayQueryKey(query) !== base
    const plan = overlayClosePlan(overlayStackFromState(window.history.state), id, changed)

    if (plan.kind === 'replace') {
      void router.replace({ query, state: { [OVERLAY_STATE_KEY]: plan.stack } as HistoryState })
      return
    }

    if (plan.steps === 1) {
      void router.back()
    } else {
      void router.go(-plan.steps)
    }
  }

  return { open, close }
}
