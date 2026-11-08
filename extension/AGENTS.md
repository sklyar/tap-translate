# AGENTS.md

Instructions for coding agents (Claude Code, Codex, and others) that work in `extension/`. The
rules for the whole repo are in the root `AGENTS.md`.

## Project

`extension/` is the Safari Web Extension: TypeScript, Vite, Vitest. Vite builds `src/content.ts`
into one IIFE file, `dist/content.js`. The content script runs on every HTTP(S) page, only in
the top document. Now it uses `MockTranslationProvider`: the backend service does not exist yet
(see `docs/roadmap.md`). How detection works is described in the root `README.md`.

- `src/content.ts`: the entry point. It listens to clicks and connects detection, the
  controller, and the sheet.
- `src/detection.ts`: finds the tapped word and builds the `DetectionContext`. It uses
  `hit-testing.ts`, `target-eligibility.ts`, `text-snapshot.ts`, and `context-extraction.ts`.
- `src/word-segmentation.ts`, `src/sentence-segmentation.ts`: word and sentence spans in a
  string. They do not use the DOM.
- `src/translation.ts`: the translation contract: `TranslationRequest`, `TranslationResult`,
  `TranslationProvider`.
- `src/translation-controller.ts`: sends requests to the provider. A new request cancels the
  previous one. A stale result is never shown.
- `src/translation-sheet.ts`: the translation UI in an open Shadow DOM. Its styles are in
  `public/translation-sheet.css`.
- `public/manifest.json`: the extension manifest. `tests/manifest.test.ts` checks it.
- `scripts/capture-contexts.ts`: captures `DetectionContext` samples from real pages for
  `eval/`. It opens the pages over the network. See `eval/README.md`.

## Commands

Run the commands in `extension/`. Run `npm ci` once.

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm run build`     | Build the extension into `dist/`.                                     |
| `npm run format`    | Format all files with Prettier. Changes files.                        |
| `npm run lint`      | Run ESLint with `eslint.config.js`.                                   |
| `npm run typecheck` | Run `tsc --noEmit`.                                                   |
| `npm test`          | Run the Vitest tests.                                                 |
| `npm run check`     | All checks: format, lint, typecheck, tests, build. CI runs the same.  |
| `npm run fixture`   | Serve the test pages from `tests/fixtures/` at http://127.0.0.1:5173. |

Run one test file: `npx vitest run tests/detection.test.ts`. Run one test by name:
`npx vitest run -t 'returns null for hidden target text'`.

## Definition of done

- `npm run check` passes.
- No new `eslint-disable`, `@ts-expect-error`, or `@ts-ignore`. If one is really needed, it names
  the rule and gives the reason:
  `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the element is created above.`
  An unused disable comment is an error.
- New behavior has tests. A bug fix has a test that fails without the fix.
- Do not edit `eslint.config.js`, `tsconfig.json`, or `prettier.config.js` to make a check pass.
  Fix the code. Change the config only when the task is about the config.
- jsdom has no layout and is not Safari. After a change to hit testing, layout, gestures, or
  the sheet, check it in Safari or in the iOS Simulator with the pages from `npm run fixture`
  (see the root `README.md`). If you cannot run Safari, say so in your report.

## Conventions

The linters check most of the code style. These rules are easy to miss:

- **The page is hostile.** The content script runs on any site, next to the site's own code and
  CSS. Do not parse strings as HTML: create elements and set `textContent`. ESLint forbids
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `createContextualFragment`, and
  `setHTMLUnsafe` in `src/`. Do not block or change the page's own handling of events outside
  the sheet: the click listener is passive.
- **Styles and CSP.** The sheet styles are in `public/translation-sheet.css`, which is loaded
  with a `<link>` inside the Shadow Root. Do not add a `<style>` element or a `style` attribute:
  Safari applies the page CSP to them. Setting one property through `element.style` works. Check
  CSP changes on `tests/fixtures/hardening-csp.html`.
- **Browser support.** The build target is Safari 15.4 and iOS 15.4. Vite transforms the syntax
  but adds no polyfills. A newer web API needs a fallback, as `caretPositionFromPoint` falls
  back to `caretRangeFromPoint`.
- **Logs.** Logs and errors never contain page text. Messages start with `[TapTranslate]`.
- **The backend contract.** `DetectionContext` is what the extension sends to the backend. The
  Go type is in `backend/internal/translation`. JSON field names are camelCase on both sides.
  If you change the shape, change both sides.
- **Files in `dist/`.** The Xcode project lists each file from `dist/` separately. If the build
  adds a new file, add it to the `TapTranslate Extension` target.
- **Language.** Code, comments, and logs are in English. The UI text is in Russian.

## Tests

- Tests are in `tests/`, one file per module: `tests/<module>.test.ts`. Import the code from
  `../src/`.
- A test that needs the DOM starts with `// @vitest-environment jsdom`. Other tests run in Node.
- jsdom has no caret APIs and no layout. Use the helpers in `tests/dom-test-helpers.ts`, such as
  `setCaretPositionFromPoint`.
- jsdom cannot dispatch trusted events. Tests pass `isTrustedClick: () => true` to
  `startTapTranslateContent` (see `tests/content.test.ts`).
- Tests make no network calls.

## Claude Code hooks

`.claude/settings.json` in the repo root runs two hooks for `extension/`:

- After each edit of a file under `extension/`: Prettier on that file.
- When Claude stops and `extension/` has uncommitted changes: the format check, ESLint, `tsc`,
  and Vitest. If they fail, Claude gets the errors and must fix them.

Both hooks need `npm ci`. Without `node_modules/` they do nothing.
