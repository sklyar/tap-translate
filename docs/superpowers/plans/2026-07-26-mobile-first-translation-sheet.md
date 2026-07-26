# Mobile-First Translation Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing detection and mock translation boundaries to an isolated, accessible, mobile-first bottom sheet with loading, success, error, retry, replacement, cancellation, and dismissal behavior.

**Architecture:** A DOM-free `TranslationController` owns provider calls and request lifecycle. `TranslationSheet` implements the controller's minimal view boundary inside an open Shadow DOM, while `content.ts` remains the browser composition root and capture-phase interaction adapter. The existing deterministic mock is wired with one delayed `turn off` success; no network, backend, storage, or background component is introduced.

**Tech Stack:** TypeScript 6.0.3, native ESM, DOM and Shadow DOM APIs, Vitest 4.1.10, jsdom 28.1.0, ESLint 10, Prettier 3.9.6, Vite 8.1.5, Safari 15.4/iOS 15.4 build targets.

## Global Constraints

- Preserve strict TypeScript, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and the current native ESM setup.
- Preserve the Vite targets `safari15.4` and `ios15.4`.
- Add no production or development dependency.
- Add no backend adapter, HTTP, background script, storage, analytics, Xcode container, gesture recognizer, DI framework, event bus, or generic state-machine library.
- Keep English → Russian as the only translation direction.
- Use the existing `TranslationRequest`, `TranslationResult`, `TranslationProvider`, and `createTranslationRequest()` contract without adding viewport geometry.
- Keep the page pointer-interactive and scrollable: never call `preventDefault()` or `stopPropagation()`, never lock `body`, and never set `aria-modal="true"`.
- Use an open Shadow DOM and render provider/page strings with DOM text nodes or `textContent`, never interpolated HTML.
- Treat cancellation as silent and never expose or log raw provider errors, requests, results, or page context.
- Keep compact/expanded as two button-toggled states; add no free dragging or swipe-to-dismiss.

## File Structure

- `extension/src/translation-controller.ts` — DOM-free request lifecycle, cancellation, retry, replacement, stale-result suppression, and view contract.
- `extension/tests/translation-controller.test.ts` — pure controller tests, including providers that ignore cancellation.
- `extension/src/translation-sheet-styles.ts` — isolated responsive Shadow DOM stylesheet string.
- `extension/src/translation-sheet.ts` — open-shadow renderer, compact/expanded state, controls, announcements, sentence highlighting, and focus restoration.
- `extension/tests/translation-sheet.test.ts` — jsdom rendering, lifecycle, event, accessibility, and isolation tests.
- `extension/src/content.ts` — default mock composition plus a small testable capture-phase interaction adapter.
- `extension/tests/content.test.ts` — integration tests for detection conversion, replacement, dismissal, shadow event exclusion, page event preservation, and delayed mock success.
- `extension/tests/fixtures/index.html` — exact `Turn the light off.` manual acceptance sentence.
- Delete `extension/src/accepted-hit-effect.ts` and `extension/tests/accepted-hit-effect.test.ts` when the sheet replaces the debug ring.

---

### Task 1: Translation Request Controller

**Files:**

- Create: `extension/src/translation-controller.ts`
- Create: `extension/tests/translation-controller.test.ts`

**Interfaces:**

- Consumes: `TranslationProvider`, `TranslationRequest`, and `TranslationResult` from `extension/src/translation.ts`.
- Produces: `TranslationViewState`, `TranslationView`, and `TranslationController` with `translate(request)`, `retry()`, and `dismiss()` methods.

- [ ] **Step 1: Write failing controller lifecycle tests**

Create `extension/tests/translation-controller.test.ts` with fixed request/result fixtures, a `TranslationView` spy, and controlled promises. Cover these exact assertions:

```ts
const view = {
  render: vi.fn<(state: TranslationViewState) => void>(),
  destroy: vi.fn<() => void>(),
};

controller.translate(request);
expect(view.render).toHaveBeenLastCalledWith({ kind: "loading", request });

success.resolve(turnOffResult);
await success.settled();
expect(view.render).toHaveBeenLastCalledWith({
  kind: "success",
  request,
  result: turnOffResult,
});
```

Also assert:

- rejection renders `{ kind: 'error', request }` without the error object;
- `retry()` invokes the provider again with the identical request object and aborts the prior signal;
- a second `translate(secondRequest)` aborts the first signal and renders only the second completion;
- a provider that ignores its aborted signal cannot overwrite the current result with stale success or stale failure;
- `dismiss()` aborts, destroys once per call safely, and prevents later completion rendering;
- a `DOMException` named `AbortError` produces no error state;
- synchronous provider and view failures do not escape into the host page.

- [ ] **Step 2: Run the focused test and verify that it fails**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation-controller.test.ts
```

Expected: FAIL because `../src/translation-controller` does not exist.

- [ ] **Step 3: Implement the minimal controller and view contract**

Create `extension/src/translation-controller.ts` with this public shape:

```ts
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "./translation";

export type TranslationViewState =
  | { readonly kind: "loading"; readonly request: TranslationRequest }
  | {
      readonly kind: "success";
      readonly request: TranslationRequest;
      readonly result: TranslationResult;
    }
  | { readonly kind: "error"; readonly request: TranslationRequest };

export interface TranslationView {
  render(state: TranslationViewState): void;
  destroy(): void;
}

export class TranslationController {
  public constructor(
    private readonly provider: TranslationProvider,
    private readonly view: TranslationView,
  ) {}

  public translate(request: TranslationRequest): void;
  public retry(): void;
  public dismiss(): void;
}
```

Store `{ request, abortController }` as the active call. Every start aborts the previous controller, renders loading, calls `provider.translate(request, { signal })`, and accepts a completion only if the captured controller is still current. Catch synchronous provider calls as well as rejected promises. Render error only for a current non-`AbortError` failure. Wrap view render/destroy calls so a broken view cannot break the page; a render failure cancels and clears the active call.

- [ ] **Step 4: Run focused tests and static checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation-controller.test.ts
rtk npm run format
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all commands pass.

- [ ] **Step 5: Commit the controller boundary**

```bash
rtk git add extension/src/translation-controller.ts extension/tests/translation-controller.test.ts
rtk git commit -m "feat(extension): add translation controller"
```

---

### Task 2: Isolated Translation Sheet

**Files:**

- Create: `extension/src/translation-sheet-styles.ts`
- Create: `extension/src/translation-sheet.ts`
- Create: `extension/tests/translation-sheet.test.ts`

**Interfaces:**

- Consumes: `TranslationView` and `TranslationViewState` from `extension/src/translation-controller.ts`.
- Produces: `TranslationSheetCallbacks` and `TranslationSheet implements TranslationView`, plus `containsEventPath(path)` for the content interaction boundary.

- [ ] **Step 1: Write failing sheet lifecycle and rendering tests**

Create `extension/tests/translation-sheet.test.ts` under the jsdom environment:

```ts
// @vitest-environment jsdom

const sheet = new TranslationSheet(document, {
  onRetry: retry,
  onDismiss: dismiss,
});

sheet.render({ kind: "loading", request });
const host = document.querySelector("[data-taptranslate-sheet-host]");
expect(host).toBeInstanceOf(HTMLElement);
expect(host?.shadowRoot).not.toBeNull();
expect(host?.shadowRoot?.textContent).toContain("Переводим");
expect(document.head.querySelector("style")).toBeNull();
```

Cover these exact behaviors:

- repeated renders reuse one host and one open shadow root;
- success renders `turn off`, `phrasal verb`, `выключить`, and the contextual explanation using text content;
- expression may differ from the clicked word;
- the handle is a button whose Russian label and `aria-expanded` change while toggling compact/expanded;
- expanded success slices the source sentence and wraps only the clicked `Turn` span in `<mark lang="en">`;
- loading and error use neutral Russian live-region messages;
- error retry and close call the supplied callbacks once;
- Escape calls dismissal without setting `defaultPrevented` or stopping another document listener;
- `containsEventPath()` recognizes only the current host path;
- `destroy()` is idempotent, removes host and keydown listener, resets expanded mode, and conditionally restores prior focus;
- provider strings containing markup render as literal text and create no injected element;
- the stylesheet contains the exact Safari-safe responsive rules: host `position: fixed`, `z-index: 2147483647`, host/scrim `pointer-events: none`, sheet `pointer-events: auto`, 52vh compact maximum, expanded safe-area height, 640px desktop maximum, visible focus, and reduced-motion query.

- [ ] **Step 2: Run the focused test and verify that it fails**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation-sheet.test.ts
```

Expected: FAIL because `../src/translation-sheet` does not exist.

- [ ] **Step 3: Add the isolated Shadow DOM stylesheet**

Create `extension/src/translation-sheet-styles.ts` exporting one `translationSheetStyles` string. Use only broadly supported CSS for Safari 15.4. The required outer rules are:

```ts
export const translationSheetStyles = `
  :host {
    all: initial !important;
    display: block !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
  }

  .scrim { position: absolute; inset: 0; pointer-events: none; }
  .sheet { pointer-events: auto; max-height: 52vh; }
  .sheet[data-expanded="true"] {
    height: calc(100vh - 16px - env(safe-area-inset-top));
  }

  @media (min-width: 768px) {
    .sheet { width: min(100%, 640px); margin-inline: auto; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet { transition-duration: 0.01ms; }
  }
`;
```

Complete the dark visual hierarchy with system fonts, safe-area bottom padding, scrolling content, AA-oriented contrast, native buttons reset locally, visible `:focus-visible`, skeleton animation, semantic section spacing, and rounded upper corners. Do not use CSS imports, constructable stylesheets, or page-global nodes.

- [ ] **Step 4: Implement the sheet renderer**

Create `extension/src/translation-sheet.ts` with this boundary:

```ts
export interface TranslationSheetCallbacks {
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}

export class TranslationSheet implements TranslationView {
  public constructor(
    private readonly documentRoot: Document,
    private readonly callbacks: TranslationSheetCallbacks,
  ) {}

  public render(state: TranslationViewState): void;
  public destroy(): void;
  public containsEventPath(path: readonly EventTarget[]): boolean;
}
```

On first render, record a connected focusable `document.activeElement`, append one `[data-taptranslate-sheet-host]` to `document.documentElement`, attach an open shadow root, insert one `<style>`, and attach one document `keydown` listener. Rebuild only shadow-owned content on state updates, retaining the host, style node, callbacks, and expanded boolean. Use `createElement()`, `createTextNode()`, and `textContent` for all data.

Success renders expression (`lang="en"`), part of speech, translation and explanation (`lang="ru"`). Expanded success derives the sentence with `text.slice(sentence.start, sentence.end)`, rebases `word` against `sentence.start`, and appends before text, `<mark lang="en">clicked word</mark>`, and after text without changing the source string. If spans are invalid, render the safely sliced sentence without a highlight.

The close and retry buttons invoke callbacks. The handle toggles `expanded`, updates `aria-expanded` and its Russian label, and re-renders the current state. Escape invokes dismissal without preventing or stopping the event. Before destroy, detect focus through `shadowRoot.activeElement`; after removing the host/listener, restore the recorded connected focusable element with `{ preventScroll: true }` only when focus ended in the sheet.

- [ ] **Step 5: Run focused tests and static checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation-sheet.test.ts
rtk npm run format
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all commands pass.

- [ ] **Step 6: Commit the presentation boundary**

```bash
rtk git add extension/src/translation-sheet.ts extension/src/translation-sheet-styles.ts extension/tests/translation-sheet.test.ts
rtk git commit -m "feat(extension): add mobile translation sheet"
```

---

### Task 3: Content Integration and Debug-Ring Retirement

**Files:**

- Modify: `extension/src/content.ts`
- Create: `extension/tests/content.test.ts`
- Modify: `extension/tests/fixtures/index.html`
- Delete: `extension/src/accepted-hit-effect.ts`
- Delete: `extension/tests/accepted-hit-effect.test.ts`

**Interfaces:**

- Consumes: `detectEnglishContext()`, `createTranslationRequest()`, `MockTranslationProvider`, `TranslationController`, and `TranslationSheet`.
- Produces: default content-script wiring and a testable `startTapTranslateContent()` listener lifecycle.

- [ ] **Step 1: Write failing capture-phase integration tests**

Create `extension/tests/content.test.ts` under jsdom. Export a minimal `startTapTranslateContent(options)` from `content.ts`, where options contain a document, controller boundary, sheet path predicate, and optional detection function. Return an idempotent cleanup callback.

The tests dispatch real bubbling/cancelable `MouseEvent('click')` instances and assert:

```ts
const stop = startTapTranslateContent({
  documentRoot: document,
  controller,
  sheet,
  detect: () => detectionResult,
});

target.dispatchEvent(
  new MouseEvent("click", { bubbles: true, cancelable: true }),
);
expect(controller.translate).toHaveBeenCalledWith(
  createTranslationRequest(detectionResult),
);
expect(pageClickListener).toHaveBeenCalledOnce();
expect(event.defaultPrevented).toBe(false);
stop();
```

Cover:

- eligible detection starts translation with the converted request;
- a second eligible click sends a replacement request;
- null detection calls `dismiss()`;
- a composed path recognized by the sheet skips detection and dismissal;
- normal page listeners still receive eligible and ineligible clicks;
- unexpected detection failure emits only `[TapTranslate] Unexpected interaction failure.` and no caught object or page content;
- cleanup removes only the TapTranslate document listener and is idempotent;
- wiring the real controller, sheet, and delayed mock renders loading first and then the fixed `turn off` success without calling `fetch`.

- [ ] **Step 2: Run the focused integration test and verify that it fails**

Run from `extension/`:

```bash
rtk npm test -- --run tests/content.test.ts
```

Expected: FAIL because `content.ts` does not expose or implement the new interaction boundary.

- [ ] **Step 3: Replace debug runtime wiring with the mock vertical slice**

Refactor `extension/src/content.ts` so the capture listener:

```ts
if (sheet.containsEventPath(event.composedPath())) return;

const result = detect(
  {
    point: { clientX: event.clientX, clientY: event.clientY },
    target: event.target,
    eventPath: event.composedPath(),
  },
  documentRoot,
);

if (result === null) {
  controller.dismiss();
  return;
}

controller.translate(createTranslationRequest(result));
```

The default composition creates:

```ts
new MockTranslationProvider({
  attempts: [
    {
      type: "success",
      delayMs: 350,
      result: {
        expression: "turn off",
        translation: "выключить",
        partOfSpeech: "phrasal verb",
        explanation: "Здесь означает выключить свет.",
      },
    },
  ],
});
```

Wire sheet retry/dismiss callbacks to the controller, install the existing passive capture-phase click listener, and retain one fixed privacy-safe catch message. The returned cleanup removes the click listener and dismisses the controller. Do not call `preventDefault()` or `stopPropagation()`.

- [ ] **Step 4: Retire the debug ring and align the fixture**

Delete `extension/src/accepted-hit-effect.ts` and `extension/tests/accepted-hit-effect.test.ts`. Remove all imports and calls. Change the fixture sentence to exactly:

```html
<p><span>Turn</span> the <strong>light</strong> <em>off</em>.</p>
```

- [ ] **Step 5: Run integration and regression checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/content.test.ts
rtk npm test -- --run tests/translation-controller.test.ts tests/translation-sheet.test.ts tests/content.test.ts
rtk npm run check
```

Expected: all tests, formatting, lint, typecheck, and production build pass; `dist/content.js` is generated without new network or runtime dependency.

- [ ] **Step 6: Commit the complete mock frontend slice**

```bash
rtk git add extension/src/content.ts extension/tests/content.test.ts extension/tests/fixtures/index.html extension/src/accepted-hit-effect.ts extension/tests/accepted-hit-effect.test.ts
rtk git commit -m "feat(extension): connect translation sheet"
```

---

### Task 4: Thorough Review and Release Gate

**Files:**

- Review: every branch diff against `master`
- Modify: only files requiring concrete review fixes

**Interfaces:**

- Consumes: the completed controller, sheet, styles, content integration, and tests.
- Produces: a clean, reviewed feature branch ready for desktop Safari acceptance and merge review.

- [ ] **Step 1: Audit scope and repository hygiene**

Run:

```bash
rtk git diff --check master...HEAD
rtk git diff --stat master...HEAD
rtk git status --short
rtk rg -n "fetch\\(|XMLHttpRequest|localStorage|sessionStorage|preventDefault|stopPropagation|aria-modal|innerHTML" extension/src extension/tests
```

Expected: no whitespace errors or unrelated files; no runtime network/storage calls, page-event suppression, modal claim, or unsafe HTML rendering.

- [ ] **Step 2: Review lifecycle and race behavior line by line**

Inspect the full diff and verify:

- every retry/replacement aborts before starting the next provider call;
- controller identity guards both success and failure;
- dismiss and view failures cannot leave a current request able to render;
- document listeners and host nodes are removed exactly once;
- sheet events are ignored before detection;
- page clicks remain passive and propagate;
- focus restoration happens only under the agreed conditions;
- arbitrary provider/page strings are never parsed as HTML or logged;
- CSS host/scrim/sheet pointer-event rules implement the non-modal policy;
- all syntax and Web APIs are compatible with Safari/iOS 15.4 or compiled by the configured Vite target.

Add a regression test before any review-driven fix.

- [ ] **Step 3: Run the complete release gate twice around the final diff check**

Run from `extension/`:

```bash
rtk npm run check
```

Then inspect `rtk git diff master...HEAD`, apply any necessary review fixes with focused tests, and run `rtk npm run check` again. Expected: both final gate and clean-tree checks pass.

- [ ] **Step 4: Commit review fixes if required**

If review finds a defect, stage only the affected source and regression test and commit:

```bash
rtk git commit -m "fix(extension): harden translation sheet lifecycle"
```

If no defect exists, create no empty commit.

- [ ] **Step 5: Report the manual acceptance boundary**

Record automated results and any remaining desktop Safari checks from the design spec. Do not claim desktop Safari acceptance unless the rebuilt extension was actually loaded and exercised there.
