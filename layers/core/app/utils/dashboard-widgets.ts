import type { Component } from 'vue'

/** Half or full width in the dashboard's two-column widget grid */
export type DashboardWidgetSpan = 1 | 2

/**
 * A widget a domain layer contributes to the home page. The core page renders
 * it inside its card chrome and knows nothing about the domain behind it.
 */
export interface DashboardWidget {
  /** Unique across layers, e.g. `mail-important` */
  id: string
  /** Only shown while a service of this domain exists */
  domain: string
  title: string
  icon: string
  /** Component to render, usually wrapped in `defineAsyncComponent` by the plugin */
  component: Component
  /** Lower comes first */
  order?: number
  span?: DashboardWidgetSpan
  /** Page the widget's "Open" link points at */
  to?: string
}

/** Widgets without an explicit order come after the ones that name one */
export const DASHBOARD_WIDGET_DEFAULT_ORDER = 100

const widgets = new Map<string, DashboardWidget>()

/** Called by a domain layer's plugin; the core knows nothing domain-specific */
export function defineDashboardWidget(widget: DashboardWidget) {
  widgets.set(widget.id, widget)
}

/** Test hook; a server render registers its widgets once at startup */
export function resetDashboardWidgets() {
  widgets.clear()
}

/** Every registered widget whose domain has a service, in display order */
export function dashboardWidgets(domains: Iterable<string>): DashboardWidget[] {
  const available = new Set(domains)

  return [...widgets.values()]
    .filter(widget => available.has(widget.domain))
    .sort((left, right) =>
      (left.order ?? DASHBOARD_WIDGET_DEFAULT_ORDER) - (right.order ?? DASHBOARD_WIDGET_DEFAULT_ORDER)
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id))
}
