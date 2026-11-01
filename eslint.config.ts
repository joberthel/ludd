import antfu from '@antfu/eslint-config'

export default antfu(
  {
    react: true,
    typescript: {
      tsconfigPath: 'tsconfig.eslint.json',
      parserOptions: {
        project: ['tsconfig.eslint.json'],
        projectService: false,
      },
      overridesTypeAware: {
        'ts/no-deprecated': 'error',
      },
    },

    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      'ts/no-unsafe-assignment': 'off',
      'ts/no-unsafe-member-access': 'off',
      'ts/no-unsafe-call': 'off',
      'ts/no-unsafe-argument': 'off',
      'ts/no-unsafe-return': 'off',
    },
  },
)
