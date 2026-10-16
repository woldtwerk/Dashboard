export default defineAppConfig({
  dashboard: {
    navigation: {
      contacts: {
        label: 'Contacts',
        icon: 'i-lucide-contact',
        to: '/contacts',
        description: 'Your address books.',
        shortcut: 'g-o',
        domain: 'contacts',
        order: 30
      }
    }
  }
})
