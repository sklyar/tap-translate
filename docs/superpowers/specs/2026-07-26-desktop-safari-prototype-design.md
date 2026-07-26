# TapTranslate Desktop Safari Prototype Design

## Purpose

Build the initial TypeScript development setup and a minimal Safari Web Extension prototype in `extension/`. The first runnable target is desktop Safari, while the web-extension bundle must remain suitable for later packaging in the iOS container application and use on iPhone.

The prototype detects an English word under a click on ordinary webpage text and logs that word to the browser console. It does not render UI, contact a backend, or change the page's normal event behavior.

## Platform and compatibility

- Use Safari Web Extension Manifest V3.
- Treat iOS 15.4 and its corresponding Safari version as the future minimum mobile target.
- Produce browser-only JavaScript that contains no Node.js or desktop-only runtime APIs.
- Keep the built web-extension resources independent of their future macOS and iOS Xcode container targets.
- Limit content-script injection to ordinary HTTP and HTTPS webpages.

## Architecture

The implementation has three focused modules:

1. `src/content.ts` owns event registration and console logging. It listens for `click` events without cancelling or modifying them, passes viewport coordinates to hit-testing, and logs only successful word detections.
2. `src/hit-testing.ts` translates viewport coordinates into a text-node offset. It prefers the standardized `Document.caretPositionFromPoint()` API when available and falls back to WebKit's `Document.caretRangeFromPoint()` for Safari versions that predate the standard API. It accepts coordinates rather than a specific event type so a future mobile gesture can reuse it unchanged.
3. `src/word-segmentation.ts` is a pure text utility. It uses `Intl.Segmenter` with the English locale and word granularity to return the word-like segment containing an exact UTF-16 offset. A returned segment must contain at least one ASCII English letter, so numeric and punctuation-only segments are rejected.

The modules communicate through narrow values: hit-testing receives `clientX` and `clientY`, resolves a text node and offset, and passes the node's text plus the offset to segmentation. The result is `string | null`.

## Detection behavior

- A click within a word logs that word once.
- A click whose resolved character is whitespace or punctuation logs nothing.
- Empty text, invalid offsets, non-text DOM nodes, unsupported hit-testing, and points that cannot be resolved log nothing.
- The prototype targets visible ordinary DOM text. Text rendered in canvas, images, form controls, generated content, and inaccessible or unsupported shadow trees is outside scope.
- The handler does not call `preventDefault()` or `stopPropagation()`. Links, selection, scrolling, and page handlers retain their normal behavior.

The point-to-text adapter must account for a caret offset being an insertion position rather than a character identity. It validates the character adjacent to the caret against the click point before segmentation, so punctuation and whitespace are not incorrectly replaced with a neighboring word.

## Mobile evolution

The initial desktop prototype uses `click` because that is the requested interaction. A production iPhone interaction may later use a long press, explicit activation mode, or another pointer policy to avoid conflicting with links and page controls. That policy belongs in `content.ts`; coordinate hit-testing and segmentation remain reusable.

The `extension/dist` output will later be incorporated as shared resources in the Safari Web Extension targets created in the `ios` Xcode project. Native app code and signing are explicitly outside this prototype.

## Tooling and build output

- The project uses native ESM (`"type": "module"`) for configuration and source development.
- TypeScript runs in strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `isolatedModules`, and `noEmit`. Vite remains the only JavaScript emitter and produces Safari 15-compatible output.
- Vite bundles `src/content.ts` into a stable `dist/content.js` filename and copies `public/manifest.json` to `dist/manifest.json`.
- Vitest runs unit tests for word segmentation.
- ESLint uses the current flat configuration format, recommended JavaScript rules, and strict type-checked TypeScript rules. Prettier compatibility is explicit so formatting and lint rules do not conflict.
- Prettier provides deterministic formatting.
- npm manages development dependencies. Direct dependency versions and the npm lockfile are committed for reproducible `npm ci` installs.
- The development baseline is Node.js 22.12 or newer. Tool versions are selected from current stable releases that support this baseline and are pinned during implementation.
- Source maps are emitted for practical debugging in desktop Safari and through Safari Web Inspector on an attached iPhone or simulator.
- `node_modules` and generated `dist` output are ignored; source files, configuration, tests, manifest, and `package-lock.json` are committed.
- No production runtime dependencies or UI frameworks are added.

## Engineering standards

- Keep side effects at the entry point. Word segmentation remains pure, and DOM-specific behavior remains inside hit-testing.
- Export narrow functions with explicit parameter and return types. Avoid classes, dependency-injection frameworks, barrel files, and speculative abstractions for this three-module prototype.
- Preserve normal page behavior and fail closed: an ambiguous or unsupported hit produces `null` rather than guessing a neighboring word.
- Keep Safari compatibility code local and documented. Feature-detect browser APIs instead of user-agent detection.
- Use one production entry point and deterministic output names so the same bundle can be copied into future macOS and iOS extension targets.
- Provide focused npm scripts for `build`, `test`, `test:watch`, `typecheck`, `lint`, `format`, `format:check`, and an aggregate `check` command suitable for local development and CI.
- Prefer table-driven unit tests with behavior-oriented names. Tests run in Node without a DOM emulator because the tested segmentation unit is platform-independent.
- Keep comments limited to compatibility rationale or non-obvious browser behavior; names and types should explain ordinary control flow.

## Testing and verification

Unit tests cover:

- words at the beginning, middle, and end of text;
- exact segment boundaries;
- punctuation and whitespace;
- English contractions;
- numeric and punctuation-only segments;
- empty strings and offsets outside the string.

Automated verification consists of the Vitest suite, strict TypeScript checking, ESLint, Prettier checking, and a production Vite build. The built manifest and stable content-script filename are inspected after the build. Manual Safari verification consists of loading the unpacked build, clicking ordinary English text, and observing one console log for a word and no log for punctuation or whitespace.

## Out of scope

- Translation UI or other page rendering
- Backend or provider calls
- Context extraction beyond the detected word
- Background scripts, messaging, storage, or extension settings
- Native iOS/macOS container implementation
- Automated Safari browser integration tests
