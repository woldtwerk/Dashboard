import SettingsMail from '../components/settings/SettingsMail.vue'

// The settings page only lists what layers register; mail owns its section.
export default defineNuxtPlugin(() => {
  defineSettingsSection({
    id: 'mail',
    label: 'Mail',
    icon: 'i-lucide-mail',
    component: SettingsMail,
    order: 15
  })
})
