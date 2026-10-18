import { fileURLToPath } from 'node:url'

// Calendar domain: provider-agnostic entities, a CalDAV provider port, API and UI.
// Connector layers (e.g. proton-dav) register a connector whose stored DAV
// credentials this layer's provider uses. Recurrence expansion and the view
// date math live in plain TypeScript under server/ and app/utils, with tests.
export default defineNuxtConfig({
  nitro: {
    // Bundle the cache migrations, so the calendar cache database can apply them
    serverAssets: [{
      baseName: 'migrations-calendar',
      dir: fileURLToPath(new URL('./server/db/cache-migrations', import.meta.url))
    }]
  }
})
