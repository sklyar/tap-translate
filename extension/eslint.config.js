import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// The content script runs on any page and shows text from the translation
// provider. It builds DOM nodes and sets text with textContent. These APIs
// parse a string as HTML, so text from the page or the model could become
// markup. document.write is caught by @typescript-eslint/no-deprecated.
const htmlSinks = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'createContextualFragment',
  'setHTMLUnsafe',
].map((property) => ({
  property,
  message: 'It parses HTML. Create elements and set textContent.',
}));

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...htmlSinks],
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },
  prettier,
);
