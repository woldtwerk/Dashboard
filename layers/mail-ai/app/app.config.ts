export default defineAppConfig({
  dashboard: {
    navigation: {
      assistant: {
        label: 'Assistant',
        icon: 'i-lucide-sparkles',
        to: '/assistant',
        description: 'Ask questions about your mail.',
        shortcut: 'g-a',
        domain: 'ai',
        order: 20
      }
    }
  }
})
