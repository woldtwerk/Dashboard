// Safety net for automation: documents Paperless ingests on its own and mail that
// arrives without a domain event are picked up here and fed to the same engine.
// Each (domain, service) is swept under its own lock, so cluster workers never
// evaluate the same window at once.
export default defineTask({
  meta: {
    name: 'automation:sweep',
    description: 'Evaluate new documents and inbox mail whose domain event was missed'
  },
  async run() {
    const swept = await sweepAutomation()

    return { result: swept }
  }
})
