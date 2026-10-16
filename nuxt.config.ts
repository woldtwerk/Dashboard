// https://nuxt.com/docs/api/configuration/nuxt-config
// Domain layers in ./layers are auto-registered (core, mail, mail-proton, ...)
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint'
  ],

  devtools: {
    enabled: true
  },

  // Test builds use their own directories, so they don't disturb a running dev server
  buildDir: process.env.NUXT_BUILD_DIR || undefined,

  compatibilityDate: '2026-06-30',
  nitro: {
    output: process.env.NUXT_OUTPUT_DIR ? { dir: process.env.NUXT_OUTPUT_DIR } : undefined
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
