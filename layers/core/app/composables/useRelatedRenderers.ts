import type { Component } from 'vue'

// A domain layer hands the generic panel a richer block by naming itself; the
// panel never grows a branch per domain.
const renderers = new Map<string, Component>()

/** Register the component a domain's related group is rendered with. Call from the domain layer's plugin. */
export function provideRelatedRenderer(domain: string, component: Component) {
  renderers.set(domain, markRaw(component))
}

/** The block registered for a domain, if any. */
export function useRelatedRenderer(domain: string): Component | undefined {
  return renderers.get(domain)
}
