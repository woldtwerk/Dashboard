export default defineAppConfig({
  dashboard: {
    navigation: {
      calendar: {
        label: 'Calendar',
        icon: 'i-lucide-calendar',
        to: '/calendar',
        description: 'Events from your calendars.',
        shortcut: 'g-c',
        domain: 'calendar',
        order: 20
      }
    }
  }
})
