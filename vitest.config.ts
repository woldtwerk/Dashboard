import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The layers import each other through the Nuxt `#layers/*` alias
    alias: {
      '#layers': fileURLToPath(new URL('./layers', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['layers/*/tests/**/*.test.ts'],
    exclude: ['.worktrees/**', '**/node_modules/**']
  }
})
