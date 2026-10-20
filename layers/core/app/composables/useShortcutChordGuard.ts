import { shallowRef } from 'vue'
import { isChordContinuation, type ChordGuardOptions, type ChordKeyState } from '../utils/shortcut-chords'

/**
 * Tracks the last two keys globally, so a bare single-key shortcut can ask
 * whether its key arrived as the second half of a `g` chord. The listener uses
 * the capture phase: Nuxt UI's own handler runs on the bubble phase, so the
 * state already names this key when its handler asks.
 */
export function useShortcutChordGuard(options: ChordGuardOptions = {}) {
  const state = shallowRef<ChordKeyState>()

  if (import.meta.client) {
    useEventListener(window, 'keydown', (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const previous = state.value
      state.value = { previous: previous?.current, previousAt: previous?.at, current: key, at: Date.now() }
    }, { capture: true })
  }

  return {
    /** Whether the key that triggered the handler belongs to an open chord. */
    shouldIgnore: (key: string) => isChordContinuation(key, state.value, options)
  }
}
