import type { DriveSelection, SelectionMode } from '../utils/drive'
import { applySelection } from '../utils/drive'

/** Multi-select state of a folder listing, keyed by path. */
export function useDriveSelection() {
  const state = ref<DriveSelection>({ selected: [] })

  return {
    selected: computed(() => state.value.selected),
    count: computed(() => state.value.selected.length),
    select(target: string, mode: SelectionMode, visible: string[]) {
      state.value = applySelection(state.value, visible, target, mode)
    },
    selectAll(visible: string[]) {
      state.value = { selected: [...visible], anchor: visible[0] }
    },
    clear() {
      state.value = { selected: [] }
    },
    /** Drops selected entries that are no longer in view, e.g. after a move */
    prune(visible: string[]) {
      state.value = { selected: state.value.selected.filter(key => visible.includes(key)) }
    }
  }
}
