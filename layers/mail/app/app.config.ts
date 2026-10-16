export default defineAppConfig({
  dashboard: {
    navigation: {
      mail: {
        label: 'Mail',
        icon: 'i-lucide-inbox',
        to: '/mail',
        description: 'Read and triage your inbox.',
        shortcut: 'g-m',
        domain: 'mail',
        order: 10
      }
    }
  }
})
