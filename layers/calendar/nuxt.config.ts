// Calendar domain: provider-agnostic entities, a CalDAV provider port, API and UI.
// Connector layers (e.g. proton-dav) register a connector whose stored DAV
// credentials this layer's provider uses. Recurrence expansion and the view
// date math live in plain TypeScript under server/ and app/utils, with tests,
// and every view renders in one IANA time zone (the `tz` cookie).
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      calendar: {
        // Time zone used when the browser's is unknown, e.g. on the server
        // render before the `tz` cookie is set. Override with
        // NUXT_PUBLIC_CALENDAR_TIME_ZONE=America/New_York
        timeZone: 'Europe/Berlin'
      }
    }
  }
})
