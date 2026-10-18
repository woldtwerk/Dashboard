import { fileURLToPath } from 'node:url'

// Automation domain layer: workflows, the decision-engine port, the workflow engine
// and the visual builder. A decision engine (the local Laya server in `automation-laya`)
// is registered via `registerDecisionEngine()` and answers the questions a decision
// node asks about an item.
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true
    },
    // Documents and mail that arrive without a domain event are recovered here;
    // the task takes a per-service lock, so only one worker sweeps a service.
    scheduledTasks: {
      '*/5 * * * *': ['automation:sweep']
    },
    // Bundle the automation cache migrations, so the built server applies them on startup
    serverAssets: [{
      baseName: 'migrations-automation',
      dir: fileURLToPath(new URL('./server/db/cache-migrations', import.meta.url))
    }]
  }
})
