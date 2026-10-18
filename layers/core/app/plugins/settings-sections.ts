import SettingsGeneral from '../components/settings/SettingsGeneral.vue'
import SettingsNotifications from '../components/settings/SettingsNotifications.vue'

// The settings page only lists what layers register; it knows no domain itself.
export default defineNuxtPlugin(() => {
  defineSettingsSection({
    id: 'general',
    label: 'General',
    icon: 'i-lucide-sliders-horizontal',
    component: SettingsGeneral,
    order: 10
  })

  defineSettingsSection({
    id: 'notifications',
    label: 'Notifications',
    icon: 'i-lucide-bell',
    component: SettingsNotifications,
    order: 20
  })
})
