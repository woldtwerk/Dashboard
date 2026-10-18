import SettingsAssistant from '../components/settings/SettingsAssistant.vue'

// The settings page only lists what layers register; mail-ai owns its section.
export default defineNuxtPlugin(() => {
  defineSettingsSection({
    id: 'assistant',
    label: 'Assistant',
    icon: 'i-lucide-sparkles',
    component: SettingsAssistant,
    order: 30
  })
})
