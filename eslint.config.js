import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['client/dist/', 'dist/', 'data/', 'node_modules/'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['server/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['client/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
];
