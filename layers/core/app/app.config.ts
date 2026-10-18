export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc'
    }
  },
  dashboard: {
    navigation: {
      home: {
        label: 'Home',
        icon: 'i-lucide-house',
        to: '/',
        shortcut: 'g-h',
        order: 0
      },
      services: {
        label: 'Services',
        icon: 'i-lucide-blocks',
        to: '/services',
        shortcut: 'g-s',
        order: 90
      },
      logs: {
        label: 'Logs',
        icon: 'i-lucide-scroll-text',
        to: '/logs',
        shortcut: 'g-l',
        order: 85
      }
    }
  }
})
