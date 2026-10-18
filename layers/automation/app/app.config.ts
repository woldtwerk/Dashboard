export default defineAppConfig({
  dashboard: {
    navigation: {
      automation: {
        label: 'Automation',
        icon: 'i-lucide-workflow',
        to: '/automation',
        description: 'Rule-based workflows for mail and documents.',
        shortcut: 'g-a',
        order: 40
      }
    }
  }
})
