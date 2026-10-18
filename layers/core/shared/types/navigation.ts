/** User order and label override of one sidebar entry; stored server side */
export interface NavigationPreference {
  key: string
  /** Overrides the layer's label; null keeps the default */
  label: string | null
  /** Position in the sidebar; lower comes first */
  position: number
}
