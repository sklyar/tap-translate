# Mock Frontend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the complete detection-to-mock-translation frontend against hostile pages, dynamic DOM replacement, page lifecycle changes, and repeated interaction while preserving the existing product behavior and Safari 15.4 support.

**Architecture:** Keep the existing direct composition (`DetectionResult` → request mapper → controller → mock provider → shadow-DOM sheet). Add only two bounded runtime behaviors: self-healing remount inside `TranslationSheet` and `pagehide` dismissal inside the content interaction. Pin the top-frame policy in the manifest, reproduce page hazards in local fixtures, and prove resource/concurrency invariants with deterministic Vitest tests.

**Tech Stack:** Strict TypeScript, native ESM, DOM APIs available in Safari/iOS 15.4, Vitest 4 with jsdom, Vite 8, ESLint, Prettier. No new dependencies.

## Global Constraints

- Work only on `feature/mock-frontend-hardening`.
- Preserve the public translation and detection contracts.
- Do not add backend, HTTP, storage, analytics, background scripts, Xcode/iOS container code, iframe support, navigation patching, observers, polling, scroll handlers, or resize handlers.
- Keep one content click listener, at most one window `pagehide` listener, at most one mounted sheet host, at most one sheet-owned document keydown listener, and at most one current provider request.
- Keep user/page strings out of logs and render provider strings with `textContent` only.
- Use fake timers and final-state/resource assertions; do not add elapsed-time, heap-size, screenshot-golden, or public-network tests.
- Every production behavior change begins with a failing focused test.
- Run focused tests after each red/green cycle and `npm run check` before the final review.

## File Structure

- Modify `extension/src/translation-sheet.ts` — recognize a disconnected host and remount without changing state or focus ownership.
- Modify `extension/src/content.ts` — dismiss on `pagehide` and remove both lifecycle listeners during explicit cleanup.
- Modify `extension/public/manifest.json` — explicitly set the existing content script to top-document injection.
- Modify `extension/tests/translation-sheet.test.ts` — detached-host, focus, listener, repetition, and long-string regressions.
- Modify `extension/tests/content.test.ts` — dynamic DOM, `pagehide`, cleanup, and repeated end-to-end interaction regressions.
- Modify `extension/tests/translation-controller.test.ts` — out-of-order request-burst regression.
- Create `extension/tests/manifest.test.ts` — deterministic manifest-policy contract test.
- Create `extension/tests/fixtures/hardening.html` — hostile/dynamic manual Safari fixture.
- Create `extension/tests/fixtures/hardening-csp.html` — restrictive-CSP manual Safari fixture.
- Create `docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md` — durable desktop Safari test record.

---

### Task 1: Recover a detached translation-sheet host

**Files:**

- Modify: `extension/tests/translation-sheet.test.ts`
- Modify: `extension/src/translation-sheet.ts`

**Step 1: Write failing detached-host tests**

Add focused lifecycle tests that establish all recovery semantics:

```ts
it("remounts a detached host while preserving state and expansion", () => {
  const { sheet } = createSheet();
  sheet.render(successState);
  requiredElement("[data-taptranslate-expand]").click();
  const staleHost = requiredHost();

  staleHost.remove();
  sheet.render(successState);

  expect(requiredHost()).not.toBe(staleHost);
  expect(
    document.querySelectorAll("[data-taptranslate-sheet-host]"),
  ).toHaveLength(1);
  expect(
    requiredElement("[data-taptranslate-sheet]").getAttribute("data-expanded"),
  ).toBe("true");
  expect(requiredShadowRoot().textContent).toContain("turn off");
});

it("replaces the sheet keydown listener instead of duplicating it", () => {
  const addEventListener = vi.spyOn(document, "addEventListener");
  const removeEventListener = vi.spyOn(document, "removeEventListener");
  const { sheet, dismiss } = createSheet();

  sheet.render(successState);
  requiredHost().remove();
  sheet.render(successState);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  expect(dismiss).toHaveBeenCalledOnce();
  expect(
    addEventListener.mock.calls.filter(([type]) => type === "keydown"),
  ).toHaveLength(2);
  expect(
    removeEventListener.mock.calls.filter(([type]) => type === "keydown"),
  ).toHaveLength(1);
});
```

Add a focus test: focus page button A before the first render, detach the host, focus page button B, recover, focus the recovered close button, destroy, and assert button A is restored. This proves recovery neither restores nor recaptures focus.

Add a fixed-count loop (20 iterations) that repeatedly renders, removes the current host, rerenders, and finally destroys; assert no host remains and Escape invokes no callback afterward.

Run:

```bash
cd extension
npm test -- translation-sheet.test.ts
```

Expected: the new tests fail because `ensureMounted()` trusts stale references.

**Step 2: Implement recovery as a private mount concern**

Add one focus-capture flag and two small helpers. The intended shape is:

```ts
private focusCaptureComplete = false;

private ensureMounted(): void {
  if (this.isMountConnected()) {
    return;
  }

  if (this.host !== undefined || this.shadowRoot !== undefined) {
    this.releaseMount();
  }

  if (!this.focusCaptureComplete) {
    this.previouslyFocused = getRestorableActiveElement(this.documentRoot);
    this.focusCaptureComplete = true;
  }

  const host = this.documentRoot.createElement('div');
  host.setAttribute('data-taptranslate-sheet-host', '');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const styleElement = this.documentRoot.createElement('style');
  styleElement.textContent = translationSheetStyles;
  shadowRoot.append(styleElement);
  this.documentRoot.documentElement.append(host);
  this.documentRoot.addEventListener('keydown', this.handleKeyDown);

  this.host = host;
  this.shadowRoot = shadowRoot;
  this.styleElement = styleElement;
}

private isMountConnected(): boolean {
  return (
    this.host !== undefined &&
    this.host.isConnected &&
    this.shadowRoot === this.host.shadowRoot &&
    this.styleElement !== undefined
  );
}

private releaseMount(): void {
  this.documentRoot.removeEventListener('keydown', this.handleKeyDown);
  this.host?.remove();
  this.host = undefined;
  this.shadowRoot = undefined;
  this.styleElement = undefined;
}
```

Refactor `destroy()` to compute focus restoration before calling `releaseMount()`, then clear `currentState`, `previouslyFocused`, `expanded`, and `focusCaptureComplete`. Do not reset `currentState` or `expanded` during internal recovery.

**Step 3: Run focused sheet tests**

```bash
cd extension
npm test -- translation-sheet.test.ts
npm run typecheck
```

Expected: pass.

**Step 4: Commit**

```bash
git add extension/src/translation-sheet.ts extension/tests/translation-sheet.test.ts
git commit -m "fix(extension): recover detached translation sheet"
```

---

### Task 2: Harden content interaction across dynamic DOM and `pagehide`

**Files:**

- Modify: `extension/tests/content.test.ts`
- Modify: `extension/src/content.ts`

**Step 1: Prevent the module-level composition from affecting lifecycle tests**

Extend the existing dynamic-import setup so it temporarily suppresses both default listeners while importing `content.ts`:

```ts
const originalDocumentAdd = document.addEventListener.bind(document);
const originalWindowAdd = window.addEventListener.bind(window);
const documentAdd = vi
  .spyOn(document, "addEventListener")
  .mockImplementation((type, listener, options) => {
    if (type !== "click") {
      originalDocumentAdd(type, listener, options);
    }
  });
const windowAdd = vi
  .spyOn(window, "addEventListener")
  .mockImplementation((type, listener, options) => {
    if (type !== "pagehide") {
      originalWindowAdd(type, listener, options);
    }
  });

const contentModule = await import("../src/content");
startTapTranslateContent = contentModule.startTapTranslateContent;
documentAdd.mockRestore();
windowAdd.mockRestore();
```

**Step 2: Write failing lifecycle tests**

Add these cases:

1. Start the interaction, insert a new paragraph afterward, click it, and have the detector return a result only when `input.target` is that paragraph. Assert a translation is sent without restarting.
2. Dispatch `pagehide` and assert one dismissal.
3. Dispatch persisted `pagehide`, then click eligible content, and assert translation still occurs because the document click listener remains.
4. Spy on `document.removeEventListener` and `window.removeEventListener`, call explicit cleanup twice, and assert one click removal, one `pagehide` removal, and one cleanup dismissal.
5. Click after cleanup and assert no new detection, translation, or dismissal.

Use a cross-jsdom-compatible persisted event:

```ts
const pageHide = new Event("pagehide");
Object.defineProperty(pageHide, "persisted", { value: true });
window.dispatchEvent(pageHide);
```

Run:

```bash
cd extension
npm test -- content.test.ts
```

Expected: dynamic insertion already passes; the `pagehide` and window-listener assertions fail.

**Step 3: Add the bounded page-lifecycle listener**

Use the document's own window, not the ambient global:

```ts
const windowRoot = options.documentRoot.defaultView;

const dismissSafely = (): void => {
  try {
    options.controller.dismiss();
  } catch {
    // Lifecycle cleanup must not surface extension failures onto the page.
  }
};

const handlePageHide = (): void => {
  dismissSafely();
};

windowRoot?.addEventListener("pagehide", handlePageHide);
```

In explicit cleanup, guard with the existing `listening` flag, remove the capture click listener and window `pagehide` listener, then call `dismissSafely()` exactly once. Keep the click listener installed when `pagehide` itself fires.

**Step 4: Run focused content tests**

```bash
cd extension
npm test -- content.test.ts
npm run typecheck
```

Expected: pass.

**Step 5: Commit**

```bash
git add extension/src/content.ts extension/tests/content.test.ts
git commit -m "fix(extension): handle page lifecycle"
```

---

### Task 3: Pin and test the top-document manifest policy

**Files:**

- Create: `extension/tests/manifest.test.ts`
- Modify: `extension/public/manifest.json`

**Step 1: Write the failing manifest contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ManifestContentScript {
  readonly matches?: readonly string[];
  readonly js?: readonly string[];
  readonly run_at?: string;
  readonly all_frames?: boolean;
}

interface ExtensionManifest {
  readonly content_scripts?: readonly ManifestContentScript[];
}

describe("extension manifest", () => {
  it("injects the content script only into top-level HTTP(S) documents", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
    ) as ExtensionManifest;

    expect(manifest.content_scripts).toEqual([
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: false,
      },
    ]);
  });
});
```

Run:

```bash
cd extension
npm test -- manifest.test.ts
```

Expected: fail because `all_frames` is currently implicit.

**Step 2: Make the policy explicit**

Change the existing content-script entry to:

```json
{
  "matches": ["http://*/*", "https://*/*"],
  "js": ["content.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

**Step 3: Verify and commit**

```bash
cd extension
npm test -- manifest.test.ts
npm run typecheck
cd ..
git add extension/public/manifest.json extension/tests/manifest.test.ts
git commit -m "test(extension): pin top-frame manifest policy"
```

Expected: pass.

---

### Task 4: Add deterministic stress and data-safety regressions

**Files:**

- Modify: `extension/tests/translation-controller.test.ts`
- Modify: `extension/tests/translation-sheet.test.ts`
- Modify: `extension/tests/content.test.ts`

**Step 1: Add an out-of-order controller burst**

Create 20 unique requests and deferred results, issue every request, resolve them from newest to oldest, and assert only the latest success renders after its loading state:

```ts
it("renders only the latest success from an out-of-order request burst", async () => {
  const count = 20;
  const deferred = Array.from({ length: count }, () =>
    createDeferred<TranslationResult>(),
  );
  const translate = vi.fn<TranslationProvider["translate"]>(
    (_request, _options) => {
      const callIndex = translate.mock.calls.length - 1;
      const pending = deferred[callIndex];
      if (pending === undefined) {
        throw new Error("Missing deferred translation");
      }
      return pending.promise;
    },
  );
  const view = createView();
  const controller = new TranslationController({ translate }, view.boundary);
  const requests = Array.from(
    { length: count },
    (_, index) =>
      ({
        context: {
          ...request.context,
          focusBlock: {
            ...request.context.focusBlock,
            text: `Word ${index}.`,
          },
        },
      }) satisfies TranslationRequest,
  );

  for (const current of requests) controller.translate(current);
  for (let index = count - 1; index >= 0; index -= 1) {
    deferred[index]?.resolve({ ...turnOffResult, expression: `word-${index}` });
    await flushPromises();
  }

  expect(view.render).toHaveBeenCalledTimes(count + 1);
  expect(view.render).toHaveBeenLastCalledWith({
    kind: "success",
    request: requests[count - 1],
    result: { ...turnOffResult, expression: `word-${count - 1}` },
  });
});
```

Adjust the callback implementation if Vitest call accounting makes the call index ambiguous; keep all array access guarded under `noUncheckedIndexedAccess`.

**Step 2: Expand sheet string-safety coverage**

Render a result whose expression, translation, part of speech, and explanation contain long repeated Unicode text plus HTML-shaped strings. Assert no injected element exists, exact strings remain in `textContent`, and the shadow root still contains exactly one style node. Do not assert jsdom layout dimensions.

**Step 3: Add repeated end-to-end interaction coverage**

Use fake timers with the real `MockTranslationProvider`, `TranslationController`, and `TranslationSheet`. Run a fixed 20-cycle sequence containing eligible click → loading → timer completion → expand → replacement click → completion → ineligible external click. At the end assert:

```ts
expect(
  document.querySelectorAll("[data-taptranslate-sheet-host]"),
).toHaveLength(0);
expect(vi.getTimerCount()).toBe(0);
```

Spy on document keydown addition/removal during the sequence and assert the counts balance after explicit cleanup. Also retain the existing assertion that sheet-originated events are ignored while a normal page listener still receives page clicks.

**Step 4: Run focused and combined suites**

```bash
cd extension
npm test -- translation-controller.test.ts translation-sheet.test.ts content.test.ts
npm run typecheck
```

Expected: pass without production code changes beyond Tasks 1–2.

**Step 5: Commit**

```bash
git add extension/tests/translation-controller.test.ts extension/tests/translation-sheet.test.ts extension/tests/content.test.ts
git commit -m "test(extension): add mock frontend stress coverage"
```

---

### Task 5: Add local Safari hardening fixtures

**Files:**

- Create: `extension/tests/fixtures/hardening.html`
- Create: `extension/tests/fixtures/hardening-csp.html`

**Step 1: Create the hostile and dynamic fixture**

Build one standalone page with:

- hostile global element and typography rules, with selected `!important` declarations;
- light and dark reading regions;
- sticky navigation and a fixed high-z-index page overlay;
- ordinary link, button, and input controls plus a visible page-event counter;
- deeply nested inline text and a long scrollable article;
- buttons that replace a reading block and remove `[data-taptranslate-sheet-host]`;
- a long sentence for wrapping/internal scrolling;
- a same-origin iframe populated through `srcdoc`.

Use this exact interaction logic so the fixture remains deterministic and contains no extension hooks:

```html
<script type="module">
  const counter = document.querySelector("#page-event-count");
  const replaceButton = document.querySelector("#replace-reading-block");
  const removeHostButton = document.querySelector("#remove-sheet-host");
  let pageEvents = 0;

  document.addEventListener("click", () => {
    pageEvents += 1;
    if (counter) counter.textContent = String(pageEvents);
  });

  replaceButton?.addEventListener("click", () => {
    const current = document.querySelector("#dynamic-reading-block");
    const replacement = document.createElement("p");
    replacement.id = "dynamic-reading-block";
    replacement.textContent =
      "The dynamically replaced paragraph remains eligible for translation.";
    current?.replaceWith(replacement);
  });

  removeHostButton?.addEventListener("click", () => {
    document.querySelector("[data-taptranslate-sheet-host]")?.remove();
  });
</script>
```

Fixture-only CSS may style its own controls with high-specificity `!important` rules so they remain usable, but it must not select TapTranslate attributes or shadow content.

**Step 2: Create the CSP fixture**

Create a minimal page with no inline style and this restrictive policy:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; style-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'"
/>
```

Include a heading, multiple English paragraphs, a link, and a button. The page exists only to observe in desktop Safari whether the extension-created shadow `<style>` is applied.

**Step 3: Verify fixtures and production exclusion**

```bash
cd extension
npm run format
npm run build
rg -n "replace-reading-block|remove-sheet-host|dynamic-reading-block" dist
```

Expected: build passes and `rg` returns no matches from `dist`.

**Step 4: Commit**

```bash
git add extension/tests/fixtures/hardening.html extension/tests/fixtures/hardening-csp.html
git commit -m "test(extension): add Safari hardening fixtures"
```

---

### Task 6: Create the manual desktop Safari acceptance record

**Files:**

- Create: `docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md`

**Step 1: Write a durable, initially unexecuted record**

Include environment fields for date, Safari version, macOS version, branch/commit, and tester. Add required rows for:

1. local hostile/dynamic fixture;
2. local CSP fixture;
3. long-form article;
4. technical documentation;
5. news page;
6. dynamically rendered SPA;
7. sticky/fixed-overlay page;
8. complex typography/nested-inline page.

For every row record concrete URL, status (`Not run`, `Pass`, `Documented limitation`, or `Regression`), and notes/regression reference. Beneath the matrix provide a per-page checklist containing:

- eligible English word and phrase-adjacent clicks;
- punctuation, whitespace, control, link, and iframe rejection;
- loading and fixed mock success;
- compact/expanded behavior and internal scrolling;
- rapid replacement, close, Escape, external-click dismissal, and `pagehide`/back behavior;
- page scroll, viewport resize, page links/buttons/inputs, console errors, and network requests.

State explicitly that all required rows must be executed before Stage 5 is complete, that public URLs are evidence rather than automated contracts, and that Safari-specific CSP failure requires a follow-up design decision rather than an unreviewed architecture change.

**Step 2: Format, inspect, and commit**

```bash
cd extension
npm run format
cd ..
git diff --check
git add docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md
git commit -m "docs: add mock frontend acceptance matrix"
```

Expected: record exists with every row `Not run`; do not claim Stage 5 complete yet.

---

### Task 7: Full verification and thorough review

**Files:**

- Review all files changed from `origin/master`
- Modify only files with a demonstrated issue

**Step 1: Run the complete extension gate**

```bash
cd extension
npm run check
```

Expected: formatting, lint, strict typecheck, all unit tests, and production build pass.

**Step 2: Verify scope and bundle hygiene**

```bash
cd ..
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
git diff -- extension/package.json extension/package-lock.json
rg -n "MutationObserver|pushState|replaceState|popstate|hashchange|setInterval|scroll|resize" extension/src
rg -n "replace-reading-block|remove-sheet-host|dynamic-reading-block" extension/dist
git status --short
```

Expected:

- no dependency-file changes;
- no observers, router patching, polling, scroll, or resize runtime work;
- no fixture controls in the production bundle;
- no whitespace errors or unintended files.

**Step 3: Review the complete diff against the design**

Inspect `git diff origin/master...HEAD` line by line. Confirm:

- disconnected recovery removes stale listener/references, preserves view/expansion, and neither restores nor recaptures focus;
- normal destroy still conditionally restores original page focus and resets mode;
- `pagehide` dismisses without removing the click listener;
- explicit cleanup removes click and `pagehide` exactly once and is idempotent;
- the manifest remains HTTP(S), `document_idle`, and top-frame-only;
- tests assert outcomes and resource counts, not elapsed time or browser layout;
- public-site URLs are absent from automated tests;
- no page/provider data is logged, persisted, or transmitted;
- Safari/iOS 15.4-compatible APIs and native ESM remain intact.

If review reveals a defect, add the smallest failing regression, make the minimal correction, rerun `npm run check`, and commit the fix separately as `fix(extension): address hardening review`.

**Step 4: Hand off manual Safari execution**

Run the local fixture server:

```bash
cd extension
npm run fixture
```

Use the URLs printed by Vite to execute the two local rows and then the six recorded public-page rows in desktop Safari. Update the acceptance record with the exact environment, concrete URLs, results, and limitation/regression references. Stage 5 is complete only after those required rows are no longer `Not run` and any reproducible regressions have focused tests.
