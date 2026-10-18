import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardWidgets, defineDashboardWidget, resetDashboardWidgets } from '../app/utils/dashboard-widgets'

const component = () => null

beforeEach(() => {
  resetDashboardWidgets()
})

describe('dashboardWidgets', () => {
  it('orders widgets by their order number', () => {
    defineDashboardWidget({ id: 'calendar-upcoming', domain: 'calendar', title: 'Upcoming', icon: 'i-lucide-calendar', component, order: 20 })
    defineDashboardWidget({ id: 'mail-important', domain: 'mail', title: 'Important mails', icon: 'i-lucide-mail', component, order: 10 })

    expect(dashboardWidgets(new Set(['mail', 'calendar'])).map(widget => widget.id)).toEqual(['mail-important', 'calendar-upcoming'])
  })

  it('puts widgets without an order last', () => {
    defineDashboardWidget({ id: 'late', domain: 'mail', title: 'Late', icon: 'i-lucide-mail', component })
    defineDashboardWidget({ id: 'early', domain: 'mail', title: 'Early', icon: 'i-lucide-mail', component, order: 5 })

    expect(dashboardWidgets(new Set(['mail'])).map(widget => widget.id)).toEqual(['early', 'late'])
  })

  it('only returns widgets whose domain has a service', () => {
    defineDashboardWidget({ id: 'mail-important', domain: 'mail', title: 'Important mails', icon: 'i-lucide-mail', component, order: 10 })
    defineDashboardWidget({ id: 'calendar-upcoming', domain: 'calendar', title: 'Upcoming', icon: 'i-lucide-calendar', component, order: 20 })

    expect(dashboardWidgets(new Set(['calendar'])).map(widget => widget.id)).toEqual(['calendar-upcoming'])
    expect(dashboardWidgets(new Set())).toEqual([])
  })

  it('keeps the same order deterministic for equal order numbers', () => {
    defineDashboardWidget({ id: 'b', domain: 'mail', title: 'Bravo', icon: 'i-lucide-mail', component, order: 10 })
    defineDashboardWidget({ id: 'a', domain: 'mail', title: 'Alpha', icon: 'i-lucide-mail', component, order: 10 })

    expect(dashboardWidgets(new Set(['mail'])).map(widget => widget.id)).toEqual(['a', 'b'])
  })

  it('replaces a widget registered again under the same id', () => {
    defineDashboardWidget({ id: 'mail-important', domain: 'mail', title: 'Old', icon: 'i-lucide-mail', component, order: 10 })
    defineDashboardWidget({ id: 'mail-important', domain: 'mail', title: 'New', icon: 'i-lucide-mail', component, order: 10 })

    expect(dashboardWidgets(new Set(['mail']))).toMatchObject([{ title: 'New' }])
  })
})
