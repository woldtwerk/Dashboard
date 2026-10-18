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

  // Worktrees of parallel coding agents are separate apps with their own dev server
  ignore: ['.worktrees/**'],

  compatibilityDate: '2026-06-30',
  nitro: {
    output: process.env.NUXT_OUTPUT_DIR ? { dir: process.env.NUXT_OUTPUT_DIR } : undefined
  },

  // Their file changes must not restart this dev server
  vite: {
    server: {
      // imgproxy fetches the app's session-less source endpoint as
      // http://web:3000 inside the project network; without this Vite's host
      // check answers that request with a 403 before it reaches the route.
      allowedHosts: ['web'],
      watch: {
        ignored: ['**/.worktrees/**']
      }
    }
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
