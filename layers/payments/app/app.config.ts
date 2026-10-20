export default defineAppConfig({
  dashboard: {
    navigation: {
      payments: {
        label: 'Payments',
        icon: 'i-lucide-hand-coins',
        to: '/payments',
        description: 'Payment requests and what is still open.',
        shortcut: 'g-p',
        domain: 'payments',
        order: 35
      }
    }
  }
})
