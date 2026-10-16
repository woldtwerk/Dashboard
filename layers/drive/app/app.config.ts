export default defineAppConfig({
  dashboard: {
    navigation: {
      drive: {
        label: 'Drive',
        icon: 'i-lucide-hard-drive',
        to: '/drive',
        description: 'Browse and manage your files.',
        shortcut: 'g-d',
        domain: 'drive',
        order: 20
      }
    }
  }
})
