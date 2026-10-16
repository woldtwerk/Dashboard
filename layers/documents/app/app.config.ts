export default defineAppConfig({
  dashboard: {
    navigation: {
      documents: {
        label: 'Documents',
        icon: 'i-lucide-file-text',
        to: '/documents',
        description: 'Search, upload and manage your document archive.',
        shortcut: 'g-o',
        domain: 'documents',
        order: 30
      }
    }
  }
})
