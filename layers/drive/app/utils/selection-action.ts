import type { ButtonProps } from '@nuxt/ui'

/** One icon action the drive selection toolbar renders. */
export interface DriveSelectionAction {
  key: string
  label: string
  icon: string
  color?: ButtonProps['color']
}
