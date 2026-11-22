import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'bin': 'src/bin.ts',
    'index': 'src/index.ts',
    'commands/abort': 'src/commands/abort.tsx',
    'commands/gate': 'src/commands/gate.tsx',
    'commands/gc': 'src/commands/gc.tsx',
    'commands/resume': 'src/commands/resume.tsx',
    'commands/run': 'src/commands/run.tsx',
    'commands/status': 'src/commands/status.tsx',
    'commands/teardown': 'src/commands/teardown.tsx',
  },
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  clean: true,
  dts: true,
  deps: {
    alwaysBundle: [/^@inkjs\/ui/, /^pastel/],
  },
})
