import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint flat configuration.
 */
export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'logs/**', '*.log'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      'no-param-reassign': ['error', { props: false }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'import/first': 'off',
    },
  },
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];