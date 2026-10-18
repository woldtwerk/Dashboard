import type { Ref } from 'vue'
import type { LogEntry, LogQuery } from '#layers/core/shared/types/logs'
import { toLogQueryString } from '../utils/logs'

/**
 * Subscribes to `/api/logs/stream` for a filtered log feed. The EventSource is
 * reopened when the query changes and closed on unmount or when `enabled` is
 * false, so the stream follows the Live switch without leaking.
 */
export function useLogStream(
  query: Ref<LogQuery>,
  onEntry: (entry: LogEntry) => void,
  enabled: Ref<boolean> = ref(true)
) {
  if (!import.meta.client) {
    return
  }

  let source: EventSource | undefined

  function close() {
    source?.close()
    source = undefined
  }

  function open() {
    close()
    if (!enabled.value) {
      return
    }

    const suffix = toLogQueryString(query.value)
    const current = new EventSource(`/api/logs/stream${suffix ? `?${suffix}` : ''}`)
    source = current
    current.addEventListener('log', (message) => {
      try {
        onEntry(JSON.parse((message as MessageEvent).data) as LogEntry)
      } catch {
        // Malformed payloads are dropped; the server only sends valid entries
      }
    })
  }

  watch([query, enabled], open, { immediate: true, deep: true })
  onScopeDispose(close)
}
