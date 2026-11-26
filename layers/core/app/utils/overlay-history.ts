/** The key under which the open overlay ids live in `window.history.state` */
export const OVERLAY_STATE_KEY = '__overlayStack'

/** Key under which the query state before an overlay opened is stored */
export const OVERLAY_BASE_KEY = '__overlayBase'

/**
 * Reads the overlay stack carried by a history entry. Only string entries of
 * an array under `OVERLAY_STATE_KEY` count; the result is always a fresh array.
 */
export function overlayStackFromState(state: unknown): string[] {
  const stack = typeof state === 'object' && state !== null
    ? (state as Record<string, unknown>)[OVERLAY_STATE_KEY]
    : undefined

  return Array.isArray(stack) ? stack.filter((id): id is string => typeof id === 'string') : []
}

/**
 * State for an entry that opens `id` on top of `stack`. The id is appended to a
 * new stack even when it is already present, so repeated pushes keep their
 * depth; the input stack is never mutated.
 */
export function overlayStateFor(stack: string[], id: string): Record<string, unknown> {
  return { [OVERLAY_STATE_KEY]: [...stack, id] }
}

/** The base-query key stored on a history entry, if any */
export function overlayBaseFromState(state: unknown): string | undefined {
  const base = typeof state === 'object' && state !== null
    ? (state as Record<string, unknown>)[OVERLAY_BASE_KEY]
    : undefined

  return typeof base === 'string' ? base : undefined
}

/** Canonical, key-order-independent key for a query object; sort keys before stringifying */
export function overlayQueryKey(query: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(query).sort().map(key => [key, query[key]]))
}

/** State for an entry that opens `id` on top of `stack`, recording the page query it was opened from */
export function overlayOpenState(stack: string[], id: string, base: string): Record<string, unknown> {
  return { ...overlayStateFor(stack, id), [OVERLAY_BASE_KEY]: base }
}

export type OverlayClosePlan
  = | { kind: 'replace', stack: string[] }
    | { kind: 'go', steps: number }

/**
 * How a URL overlay close should consume history.
 * - id absent: clear it in place (deep link)
 * - id at the top and the page query changed while it was open: replace in place,
 *   keeping the change, and drop the marker
 * - otherwise: go back over every entry down to and including the id (nested overlays too)
 */
export function overlayClosePlan(stack: string[], id: string, changed: boolean): OverlayClosePlan {
  const index = stack.lastIndexOf(id)

  if (index < 0) {
    return { kind: 'replace', stack }
  }

  if (changed && index === stack.length - 1) {
    return { kind: 'replace', stack: stack.slice(0, index) }
  }

  return { kind: 'go', steps: stack.length - index }
}
