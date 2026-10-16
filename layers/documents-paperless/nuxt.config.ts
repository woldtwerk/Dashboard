// Paperless-ngx connector for the documents layer.
// The instance is reached over its REST API with a token; the setup wizard
// stores only the token (never the password). `paperless.url` is the default
// base URL the wizard offers, e.g. the DDEV container.
export default defineNuxtConfig({
  runtimeConfig: {
    paperless: {
      // NUXT_PAPERLESS_URL — base URL of the Paperless-ngx instance, e.g. http://paperless:8000 in DDEV
      url: ''
    }
  }
})
