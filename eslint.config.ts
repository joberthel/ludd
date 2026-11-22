import antfu from '@antfu/eslint-config'

export default antfu(
  {
    react: true,
    typescript: {
      tsconfigPath: 'tsconfig.json',
      parserOptions: {
        project: ['tsconfig.json'],
        projectService: false,
      },
      overridesTypeAware: {
        'ts/no-deprecated': 'error',
      },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'max-lines': [
        'warn',
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-depth': ['warn', 3],
    },
  },
  {
    files: [
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
) as any
