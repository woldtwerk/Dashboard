import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['layers/*/tests/**/*.test.ts'],
    exclude: ['.worktrees/**', '**/node_modules/**']
  }
})
