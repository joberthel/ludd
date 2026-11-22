import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/bin.ts',
    'src/index.ts',
    'src/commands/*.tsx',
  ],
  format: 'esm',
  platform: 'node',
  clean: true,
  dts: true,
  deps: {
    alwaysBundle: ['@inkjs/ui'],
  },
})
