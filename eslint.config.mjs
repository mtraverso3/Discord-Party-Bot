import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/release/', '.wrangler/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Discord and D1 payloads are loosely typed at the edges.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['admin-ui/src/**/*.{ts,tsx}', 'client/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**', 'client/**/*.{mjs,ts}', '*.{mjs,mts}'],
    ignores: ['client/src/renderer/**'],
    languageOptions: { globals: globals.node },
  },
)
