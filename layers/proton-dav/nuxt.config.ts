// Proton Calendar and Contacts connectors for the calendar and contacts layers.
// Proton has no public calendar/contacts API; access goes through carbonate, a
// CalDAV + CardDAV bridge that decrypts locally. carbonate runs as a container
// (.ddev/carbonate); the setup wizard signs the account in through its control
// API (see server/connectors).
//
// carbonate is unreleased third-party software talking to Proton's private API.
// MIT licensed; see https://github.com/develonrails/carbonate
export default defineNuxtConfig({
  runtimeConfig: {
    carbonate: {
      // NUXT_CARBONATE_URL — control API of the carbonate container, e.g. http://carbonate:8080 in DDEV.
      url: '',
      // NUXT_CARBONATE_TOKEN — the container's CARBONATE_CONTROL_TOKEN
      token: ''
    }
  }
})
