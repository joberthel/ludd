import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  typescript: {
    tsconfigPath: 'tsconfig.eslint.json',
    parserOptions: {
      project: ['tsconfig.eslint.json'],
      projectService: false,
    },
    overridesTypeAware: {
      'ts/no-deprecated': 'error',
      'ts/strict-boolean-expressions': 'off',
      'ts/no-unsafe-assignment': 'off',
      'ts/no-unsafe-member-access': 'off',
      'ts/no-unsafe-return': 'off',
      'ts/no-unsafe-argument': 'off',
      'ts/no-unsafe-call': 'off',
      'ts/no-unnecessary-type-assertion': 'off',
    },
  },

  rules: {
    'react-refresh/only-export-components': 'off',
  },
})
