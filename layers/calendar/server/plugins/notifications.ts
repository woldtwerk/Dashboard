export default defineNitroPlugin(() => {
  registerNotificationCategory({
    id: 'calendar-reminder',
    domain: 'calendar',
    label: 'Calendar reminders',
    description: 'An event is about to start.',
    defaultStyle: 'both'
  })
})
