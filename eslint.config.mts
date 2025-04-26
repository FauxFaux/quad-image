import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginJs from '@eslint/js';
import pluginVitest from '@vitest/eslint-plugin';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/*.cy.tsx']),
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    ...pluginVitest.configs.recommended,
  },
);
