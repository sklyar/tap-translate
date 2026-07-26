# TapTranslate Desktop Safari Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal, mobile-ready Safari Web Extension that detects the English word under an ordinary webpage text click and logs it to the console.

**Architecture:** A side-effect-only content entry point passes viewport coordinates to a Safari-compatible DOM hit-testing adapter. The adapter resolves and geometrically validates the exact text character before delegating to a pure, independently tested English word-segmentation function.

**Tech Stack:** TypeScript 6.0.3, Vite 8.1.5, Vitest 4.1.10, ESLint 10 flat config with typescript-eslint 8.65.0, Prettier 3.9.6, npm 11, Safari Web Extension Manifest V3.

## Global Constraints

- The future mobile baseline is iOS 15.4 and Safari 15.4.
- The development baseline is Node.js 22.13 or newer.
- Use TypeScript strict mode and native ESM for source and configuration.
- Emit Safari 15.4 and iOS 15.4 compatible JavaScript through Vite only; TypeScript must use `noEmit`.
- Use exact, mutually compatible development dependency versions and commit `package-lock.json`.
- Add no production runtime dependencies, UI frameworks, extension frameworks, or CSS frameworks.
- Preserve normal page events: do not call `preventDefault()` or `stopPropagation()`.
- Detect only ordinary HTTP/HTTPS DOM text; unsupported or ambiguous hits return `null`.
- A click on whitespace, punctuation, a number, an alphanumeric token, or non-Latin text logs nothing.
- A click on a letter in an English contraction returns the whole contraction; a click on its apostrophe logs nothing.
- Do not render UI, call a backend, add background scripts, use storage, or implement the native iOS/macOS container.

## File Structure

- `extension/package.json` — npm metadata, exact tool versions, and development/CI scripts.
- `extension/package-lock.json` — npm-generated reproducible dependency graph.
- `extension/tsconfig.json` — strict browser TypeScript settings plus Node types for Vite configuration.
- `extension/eslint.config.js` — ESLint 10 flat config with type-aware TypeScript rules.
- `extension/prettier.config.js` — minimal shared formatting policy.
- `extension/vite.config.ts` — one IIFE content-script entry, Safari/iOS targets, source maps, and deterministic output.
- `extension/public/manifest.json` — Manifest V3 content-script declaration for HTTP/HTTPS pages.
- `extension/src/word-segmentation.ts` — pure English word lookup at an exact UTF-16 character offset.
- `extension/src/hit-testing.ts` — standard-first Safari point-to-text adapter plus geometry validation.
- `extension/src/content.ts` — passive capture-phase click listener and successful-result logging.
- `extension/tests/word-segmentation.test.ts` — table-driven segmentation behavior tests.
- `.gitignore` — repository-level ignores for extension dependencies and generated build output.

---

### Task 1: Strict Toolchain and English Word Segmentation

**Files:**
- Modify: `.gitignore`
- Create: `extension/package.json`
- Create: `extension/package-lock.json`
- Create: `extension/tsconfig.json`
- Create: `extension/eslint.config.js`
- Create: `extension/prettier.config.js`
- Create: `extension/tests/word-segmentation.test.ts`
- Create: `extension/src/word-segmentation.ts`

**Interfaces:**
- Consumes: An arbitrary JavaScript string and an exact UTF-16 code-unit offset.
- Produces: `getEnglishWordAtOffset(text: string, offset: number): string | null` for the hit-testing layer.

- [ ] **Step 1: Ignore generated extension artifacts**

Append these repository-root patterns to `.gitignore`:

```gitignore

# Safari Web Extension
/extension/node_modules/
/extension/dist/
```

- [ ] **Step 2: Create the exact npm toolchain manifest**

Create `extension/package.json`:

```json
{
  "name": "tap-translate-extension",
  "version": "0.1.0",
  "private": true,
  "description": "Safari Web Extension for detecting English words on webpages.",
  "type": "module",
  "engines": {
    "node": ">=22.13.0"
  },
  "packageManager": "npm@11.17.0",
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write . --ignore-path ../.gitignore",
    "format:check": "prettier --check . --ignore-path ../.gitignore",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "22.20.1",
    "eslint": "10.8.0",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.6",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  },
  "allowScripts": {
    "fsevents@2.3.3": true
  }
}
```

- [ ] **Step 3: Add strict TypeScript, ESLint, and Prettier configuration**

Create `extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedSideEffectImports": true,
    "erasableSyntaxOnly": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Create `extension/eslint.config.js`:

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**'],
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
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },
  prettier,
);
```

Create `extension/prettier.config.js`:

```js
/** @type {import('prettier').Config} */
const config = {
  singleQuote: true,
};

export default config;
```

- [ ] **Step 4: Install dependencies and generate the lockfile**

Run from `extension/`:

```bash
rtk npm install
```

Expected: npm creates `package-lock.json` and `node_modules/`, reports no peer-dependency conflict or unreviewed install scripts, and installs no production dependencies. The pinned `fsevents` install-script approval applies only to Vite's optional macOS development file watcher.

Confirm the production dependency tree is empty:

```bash
rtk npm ls --omit=dev --depth=0
```

Expected: only `tap-translate-extension@0.1.0` is listed.

- [ ] **Step 5: Write failing segmentation tests**

Create `extension/tests/word-segmentation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getEnglishWordAtOffset } from '../src/word-segmentation';

describe('getEnglishWordAtOffset', () => {
  it.each([
    { name: 'first character', text: 'Hello world', offset: 0, expected: 'Hello' },
    { name: 'last character of first word', text: 'Hello world', offset: 4, expected: 'Hello' },
    { name: 'middle of second word', text: 'Hello world', offset: 8, expected: 'world' },
    { name: 'last character in text', text: 'Hello world', offset: 10, expected: 'world' },
    { name: 'straight-apostrophe contraction', text: "I can't wait", offset: 2, expected: "can't" },
    { name: 'curly-apostrophe contraction', text: 'I can’t wait', offset: 2, expected: 'can’t' },
    { name: 'word surrounded by punctuation', text: '"Hello"', offset: 1, expected: 'Hello' },
  ])('returns the word at the $name', ({ text, offset, expected }) => {
    expect(getEnglishWordAtOffset(text, offset)).toBe(expected);
  });

  it.each([
    { name: 'empty text', text: '', offset: 0 },
    { name: 'negative offset', text: 'Hello', offset: -1 },
    { name: 'offset at text length', text: 'Hello', offset: 5 },
    { name: 'fractional offset', text: 'Hello', offset: 1.5 },
    { name: 'whitespace', text: 'Hello world', offset: 5 },
    { name: 'punctuation', text: 'Hello, world', offset: 5 },
    { name: 'contraction apostrophe', text: "can't", offset: 3 },
    { name: 'number', text: 'Version 123', offset: 8 },
    { name: 'alphanumeric token', text: 'abc123', offset: 2 },
    { name: 'non-Latin word', text: 'Привет', offset: 0 },
  ])('returns null for $name', ({ text, offset }) => {
    expect(getEnglishWordAtOffset(text, offset)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run from `extension/`:

```bash
rtk npm test
```

Expected: FAIL because `src/word-segmentation.ts` does not exist.

- [ ] **Step 7: Implement minimal strict English segmentation**

Create `extension/src/word-segmentation.ts`:

```ts
const englishWordSegmenter = new Intl.Segmenter('en', {
  granularity: 'word',
});

const englishLetterPattern = /^[A-Za-z]$/;
const englishWordPattern = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

export function getEnglishWordAtOffset(text: string, offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    return null;
  }

  const character = text[offset];

  if (character === undefined || !englishLetterPattern.test(character)) {
    return null;
  }

  const segment = englishWordSegmenter.segment(text).containing(offset);

  if (segment?.isWordLike !== true || !englishWordPattern.test(segment.segment)) {
    return null;
  }

  return segment.segment;
}
```

- [ ] **Step 8: Run the focused tests and static checks**

Run from `extension/`:

```bash
rtk npm test
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all segmentation tests and all three static checks pass. If Prettier reports changes, run `rtk npm run format` and repeat the checks.

- [ ] **Step 9: Commit the tested segmentation foundation**

```bash
rtk git add .gitignore extension/package.json extension/package-lock.json extension/tsconfig.json extension/eslint.config.js extension/prettier.config.js extension/tests/word-segmentation.test.ts extension/src/word-segmentation.ts
rtk git commit -m "feat(extension): add strict word segmentation setup"
```

---

### Task 2: Safari Hit-Testing, Content Entry, and Production Bundle

**Files:**
- Create: `extension/src/hit-testing.ts`
- Create: `extension/src/content.ts`
- Create: `extension/public/manifest.json`
- Create: `extension/vite.config.ts`

**Interfaces:**
- Consumes: `getEnglishWordAtOffset(text: string, offset: number): string | null` from Task 1, a `ViewportPoint`, and an optional `Document`.
- Produces: `findEnglishWordAtPoint(point: ViewportPoint, documentRoot?: Document): string | null` and the browser entry bundle `dist/content.js`.

- [ ] **Step 1: Implement standard-first, fail-closed DOM hit-testing**

Create `extension/src/hit-testing.ts`:

```ts
import { getEnglishWordAtOffset } from './word-segmentation';

export interface ViewportPoint {
  readonly clientX: number;
  readonly clientY: number;
}

interface TextPosition {
  readonly node: Node;
  readonly offset: number;
}

interface PointToCaretDocument {
  caretPositionFromPoint?: (
    clientX: number,
    clientY: number,
  ) => { readonly offsetNode: Node; readonly offset: number } | null;
  caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
}

function resolveTextPosition(
  documentRoot: Document,
  { clientX, clientY }: ViewportPoint,
): TextPosition | null {
  const pointToCaretDocument = documentRoot as unknown as PointToCaretDocument;

  if (typeof pointToCaretDocument.caretPositionFromPoint === 'function') {
    const position = pointToCaretDocument.caretPositionFromPoint(clientX, clientY);

    return position === null
      ? null
      : { node: position.offsetNode, offset: position.offset };
  }

  if (typeof pointToCaretDocument.caretRangeFromPoint === 'function') {
    const range = pointToCaretDocument.caretRangeFromPoint(clientX, clientY);

    return range === null ? null : { node: range.startContainer, offset: range.startOffset };
  }

  return null;
}

function characterContainsPoint(
  documentRoot: Document,
  textNode: Text,
  characterOffset: number,
  { clientX, clientY }: ViewportPoint,
): boolean {
  const range = documentRoot.createRange();
  range.setStart(textNode, characterOffset);
  range.setEnd(textNode, characterOffset + 1);

  const rectangles = range.getClientRects();

  for (let index = 0; index < rectangles.length; index += 1) {
    const rectangle = rectangles[index];

    if (
      rectangle !== undefined &&
      rectangle.width > 0 &&
      rectangle.height > 0 &&
      clientX >= rectangle.left &&
      clientX <= rectangle.right &&
      clientY >= rectangle.top &&
      clientY <= rectangle.bottom
    ) {
      return true;
    }
  }

  return false;
}

function resolveCharacterOffset(
  documentRoot: Document,
  textNode: Text,
  caretOffset: number,
  point: ViewportPoint,
): number | null {
  if (!Number.isInteger(caretOffset) || caretOffset < 0 || caretOffset > textNode.length) {
    return null;
  }

  const candidates = [caretOffset, caretOffset - 1];
  let matchedOffset: number | null = null;

  for (const candidate of candidates) {
    if (
      candidate < 0 ||
      candidate >= textNode.length ||
      !characterContainsPoint(documentRoot, textNode, candidate, point)
    ) {
      continue;
    }

    if (matchedOffset !== null && matchedOffset !== candidate) {
      return null;
    }

    matchedOffset = candidate;
  }

  return matchedOffset;
}

export function findEnglishWordAtPoint(
  point: ViewportPoint,
  documentRoot: Document = document,
): string | null {
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    return null;
  }

  const textPosition = resolveTextPosition(documentRoot, point);

  if (textPosition === null || textPosition.node.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textNode = textPosition.node as Text;
  const characterOffset = resolveCharacterOffset(
    documentRoot,
    textNode,
    textPosition.offset,
    point,
  );

  return characterOffset === null
    ? null
    : getEnglishWordAtOffset(textNode.data, characterOffset);
}
```

- [ ] **Step 2: Add the passive content-script entry point**

Create `extension/src/content.ts`:

```ts
import { findEnglishWordAtPoint } from './hit-testing';

function handleClick(event: MouseEvent): void {
  const word = findEnglishWordAtPoint({
    clientX: event.clientX,
    clientY: event.clientY,
  });

  if (word !== null) {
    console.log('[TapTranslate] Detected word:', word);
  }
}

document.addEventListener('click', handleClick, {
  capture: true,
  passive: true,
});
```

- [ ] **Step 3: Add the minimal Manifest V3 declaration**

Create `extension/public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "TapTranslate",
  "description": "Detects English words clicked on webpages.",
  "version": "0.1.0",
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: Configure a deterministic Safari/iOS-compatible Vite bundle**

Create `extension/vite.config.ts`:

```ts
import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: ['safari15.4', 'ios15.4'],
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      name: 'TapTranslateContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
```

- [ ] **Step 5: Format and run the complete automated verification suite**

Run from `extension/`:

```bash
rtk npm run format
rtk npm run check
```

Expected: Prettier completes, all tests and strict checks pass, and Vite creates the production bundle without warnings.

- [ ] **Step 6: Inspect the extension artifact contract**

Run from `extension/`:

```bash
rtk rg --files dist
rtk node --check dist/content.js
rtk jq -e '.manifest_version == 3 and .content_scripts[0].js == ["content.js"]' dist/manifest.json
```

Expected files:

```text
dist/content.js
dist/content.js.map
dist/manifest.json
```

Expected: JavaScript syntax validation succeeds and `jq` returns `true`.

- [ ] **Step 7: Review repository scope and whitespace**

```bash
rtk git status --short
rtk git diff --check
rtk git diff --stat
```

Expected: only the four requested Task 2 extension files are uncommitted; `git diff --check` prints nothing.

- [ ] **Step 8: Commit the working Safari prototype**

```bash
rtk git add extension/src/hit-testing.ts extension/src/content.ts extension/public/manifest.json extension/vite.config.ts
rtk git commit -m "feat(extension): add Safari word hit-testing prototype"
```

## Manual Safari Acceptance Check

After the automated tasks pass:

1. Load `extension/dist` as an unsigned/temporary Safari Web Extension resource bundle using the local Safari development workflow.
2. Open an ordinary HTTP or HTTPS page and its Web Inspector console.
3. Click the first, middle, and final letter of an English word.
4. Confirm each click logs `[TapTranslate] Detected word:` followed by the complete word exactly once.
5. Click whitespace, a comma, a contraction apostrophe, a number, and non-Latin text.
6. Confirm those clicks produce no TapTranslate log.
7. Confirm links and page click handlers still behave normally.

The same `dist` resources are the input for a future iOS Safari Web Extension target; native Xcode packaging and gesture-policy work remain outside this plan.
