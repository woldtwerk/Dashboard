import type { Component } from 'vue'

/** One entry in the settings page's left-hand list */
export interface SettingsSectionDefinition {
  id: string
  label: string
  icon: string
  /** The form shown on the right; knows its domain, the page does not */
  component: Component
  /** Lower comes first */
  order?: number
}

const sections = new Map<string, SettingsSectionDefinition>()

/** Registers a settings section; call from a plugin. */
export function defineSettingsSection(section: SettingsSectionDefinition): void {
  sections.set(section.id, section)
}

export function getSettingsSections(): SettingsSectionDefinition[] {
  return [...sections.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}
