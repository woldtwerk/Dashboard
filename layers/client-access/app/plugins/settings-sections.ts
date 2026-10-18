import SettingsAppPasswords from '../components/settings/SettingsAppPasswords.vue'

// The settings page only lists what layers register; client-access owns its section.
export default defineNuxtPlugin(() => {
  defineSettingsSection({
    id: 'app-passwords',
    label: 'App passwords',
    icon: 'i-lucide-key-round',
    component: SettingsAppPasswords,
    order: 25
  })
})
