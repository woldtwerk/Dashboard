export default defineNitroPlugin(() => {
  registerNotificationCategory({
    id: 'mail-new',
    domain: 'mail',
    label: 'New mail',
    description: 'Mail that arrived in an inbox since the last sync.',
    defaultStyle: 'both'
  })
})
