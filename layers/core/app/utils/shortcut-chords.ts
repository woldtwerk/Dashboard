/** The key that starts a chord, e.g. `g` in `g a` */
export const SHORTCUT_CHORD_START = 'g'

/** Nuxt UI's default window between the two keys of a chord */
export const SHORTCUT_CHORD_WINDOW_MS = 800

export interface ChordKeyState {
  /** The key pressed before `current` */
  previous?: string
  /** `Date.now()` of that previous key */
  previousAt?: number
  /** The key pressed last */
  current?: string
  /** `Date.now()` of that last key */
  at: number
}

export interface ChordGuardOptions {
  chordStart?: string
  windowMs?: number
}

/**
 * Whether `key` is the second key of a chord, so a bare single-key shortcut in
 * another `defineShortcuts` instance must stay quiet. Nuxt UI keeps chord state
 * per instance: `g` and then `a` fires the global `g a` and, because a second
 * instance only sees `a`, its own `a` handler. This is the decision that lets
 * that handler ignore the key while the chord window is still open.
 */
export function isChordContinuation(
  key: string,
  state: ChordKeyState | undefined,
  options: ChordGuardOptions = {}
): boolean {
  if (!state || state.previousAt === undefined) {
    return false
  }
  const chordStart = options.chordStart ?? SHORTCUT_CHORD_START
  const windowMs = options.windowMs ?? SHORTCUT_CHORD_WINDOW_MS
  return state.previous === chordStart
    && state.current === key.toLowerCase()
    && state.at - state.previousAt <= windowMs
}
