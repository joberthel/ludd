import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@ludd\/([^/]+)$/,
        replacement: path.resolve(__dirname, 'packages/$1/src/index.ts'),
      },
      {
        find: /^@ludd\/([^/]+)\/(.*)$/,
        replacement: path.resolve(__dirname, 'packages/$1/src/$2'),
      },
    ],
  },
  test: {
    testTimeout: 15_000,
    globals: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/e2e/**/*.e2e.test.ts',
    ],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test/**',
        '**/*.e2e.test.ts',
      ],
    },
  },
})
