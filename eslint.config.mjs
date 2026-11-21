import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Module boundaries (ADR 0006): a module owns its router. Cross-module
    // code calls the owning module's service, never another module's router
    // or test files.
    files: ['apps/backend/src/modules/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/router.js', '../*/*.router.js'],
              message:
                'Import the owning module service instead of its router (ADR 0006).',
            },
          ],
        },
      ],
    },
  },
  {
    // Presentation primitives stay independent of features: ui/ must not
    // reach into a feature, so it can be reused and tested alone.
    files: ['apps/frontend/src/ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../features/*', '../features/**'],
              message: 'src/ui must not import from src/features (ADR 0006).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
  {
    files: ['packages/contracts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Test/smoke scripts lean on dynamic imports and untyped JSON bodies;
    // keep them pragmatic rather than exhaustively typed.
    files: ['apps/backend/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Express-style callback signatures use leading-underscore params for
    // unused args by convention.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  eslintConfigPrettier,
);
