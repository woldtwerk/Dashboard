// Drop indexed mail of removed services; their sync rows go with the service (foreign key cascade)
export default defineNitroPlugin(() => {
  serviceHooks.hook('removed', async ({ id, domain }) => {
    if (domain === 'mail') {
      await useMailSearchIndex()?.removeMailbox(id)
    }
  })
})
