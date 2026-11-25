// OpenAI-compatible chat completion APIs as AI services (see server/openai-compatible/connectors.ts)
export default defineNuxtConfig({
  runtimeConfig: {
    lumoTamer: {
      // NUXT_LUMO_TAMER_URL — control API of the Lumo proxy container, e.g. http://tamer:3004 in DDEV.
      url: '',
      // NUXT_LUMO_TAMER_TOKEN — the container's TAMER_CONTROL_TOKEN
      // (control API only: tamer has no HTTP login of its own).
      token: ''
    }
  }
})
