export interface DashboardNavigationItem {
  label: string
  icon: string
  to: string
  description?: string
  /** Keyboard shortcut, e.g. `g-m` */
  shortcut?: string
  /** Only shown once a service of this domain exists, e.g. `mail` */
  domain?: string
  /** Lower comes first */
  order?: number
}

declare module 'nuxt/schema' {
  interface AppConfigInput {
    dashboard?: {
      navigation?: Record<string, DashboardNavigationItem>
    }
  }
}
