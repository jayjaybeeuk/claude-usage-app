import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/renderer/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/renderer/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/renderer/__tests__/**', '**/*.d.ts'],
      thresholds: {
        statements: 70,
        lines: 70,
        functions: 70,
        branches: 70,
      },
      reporter: ['text', 'html'],
    },
  },
})
