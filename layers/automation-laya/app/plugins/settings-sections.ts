import SettingsAutomation from '../components/settings/SettingsAutomation.vue'

// The settings page only lists what layers register; automation owns its section.
export default defineNuxtPlugin(() => {
  defineSettingsSection({
    id: 'automation',
    label: 'Automation',
    icon: 'i-lucide-workflow',
    component: SettingsAutomation,
    order: 35
  })
})
