# Safari CSP Stylesheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSP-blocked inline Shadow DOM stylesheet with a packaged web-accessible extension stylesheet that loads before the translation overlay becomes visible.

**Architecture:** `TranslationSheet` keeps its existing open Shadow Root but mounts a single external `<link rel="stylesheet">` resolved through the WebExtension runtime. View state remains synchronous at the controller boundary while presentation waits for the link's deterministic `load` event; `error` fails closed and a distinct request can retry. Vite copies one CSS source from `public`, and the manifest exposes only that resource to the existing HTTP(S) match set.

**Tech Stack:** Strict TypeScript, native ESM, DOM and WebExtension APIs available in Safari/iOS 15.4, Manifest V3, Vitest 4 with jsdom, Vite 8, ESLint, Prettier. No new dependencies.

## Global Constraints

- Preserve the existing `TranslationView` and translation/detection contracts.
- Keep the open Shadow DOM; do not introduce a light-DOM renderer.
- Keep Safari 15.4 and iOS 15.4 as the platform floor.
- Add no background script, `scripting` permission, HTTP translation request, storage, analytics, observer, polling, router patch, DI framework, event bus, or production dependency.
- Use one packaged file named exactly `translation-sheet.css`; do not retain a second TypeScript copy of the CSS.
- Never reveal overlay markup before the stylesheet link loads.
- On stylesheet failure, remove the invisible mount and fail closed without logging page, request, result, or provider data.
- Keep at most one host, link, overlay, sheet-owned keydown listener, and current provider request.
- Every behavior change begins with a failing focused test.
- Run `npm run check` and inspect the production bundle before pushing MR #5.

## File Structure

- Create `extension/public/translation-sheet.css` — the single shipped stylesheet source.
- Delete `extension/src/translation-sheet-styles.ts` — remove the CSP-blocked embedded string and prevent style drift.
- Modify `extension/public/manifest.json` — expose only `translation-sheet.css` to the existing HTTP(S) match set.
- Modify `extension/tests/manifest.test.ts` — pin the exact web-accessible-resource contract.
- Modify `extension/src/translation-sheet.ts` — own URL resolution, link loading, fail-closed behavior, overlay replacement, and detached recovery.
- Modify `extension/tests/translation-sheet.test.ts` — drive deterministic link `load`/`error` events and retain all presentation/lifecycle assertions.
- Modify `extension/tests/content.test.ts` — adapt real-sheet integration and stress cycles to the async style gate.
- Modify `docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md` — record the observed L2 regression and required retest.

---

### Task 1: Package and expose the stylesheet

**Files:**

- Create: `extension/public/translation-sheet.css`
- Delete: `extension/src/translation-sheet-styles.ts`
- Modify: `extension/public/manifest.json`
- Modify: `extension/tests/manifest.test.ts`
- Modify: `extension/tests/translation-sheet.test.ts`

**Interfaces:**

- Consumes: the exact CSS body currently exported by `translationSheetStyles`.
- Produces: the fixed resource path `translation-sheet.css` and this manifest shape:

```ts
interface ManifestWebAccessibleResource {
  readonly resources?: readonly string[];
  readonly matches?: readonly string[];
}
```

- [ ] **Step 1: Extend the manifest test and CSS-source assertions**

Add `web_accessible_resources` to `ExtensionManifest` and extend the existing exact manifest assertion:

```ts
interface ManifestWebAccessibleResource {
  readonly resources?: readonly string[];
  readonly matches?: readonly string[];
}

interface ExtensionManifest {
  readonly content_scripts?: readonly ManifestContentScript[];
  readonly web_accessible_resources?: readonly ManifestWebAccessibleResource[];
}

expect(manifest.web_accessible_resources).toEqual([
  {
    resources: ["translation-sheet.css"],
    matches: ["http://*/*", "https://*/*"],
  },
]);
```

In `translation-sheet.test.ts`, replace the TypeScript style import with file loading:

```ts
import { readFileSync } from "node:fs";

const translationSheetStyles = readFileSync(
  new URL("../public/translation-sheet.css", import.meta.url),
  "utf8",
);
```

- [ ] **Step 2: Run the focused tests to verify red**

Run:

Working directory: `extension`.

```bash
rtk npm test -- manifest.test.ts translation-sheet.test.ts
```

Expected: FAIL because `web_accessible_resources` and `public/translation-sheet.css` do not exist.

- [ ] **Step 3: Create the single CSS source and manifest declaration**

Create `public/translation-sheet.css` by moving every line inside the current `translationSheetStyles` template literal, from `:host {` through the closing reduced-motion media rule. Remove only the TypeScript export declaration, opening backtick, closing backtick, and semicolon; do not change any CSS selector or declaration during this mechanical move. The resulting file starts with `:host {` and ends with the final `}` of `@media (prefers-reduced-motion: reduce)`.

Delete `src/translation-sheet-styles.ts`. Add this top-level manifest entry without changing the existing content script:

```json
"web_accessible_resources": [
  {
    "resources": ["translation-sheet.css"],
    "matches": ["http://*/*", "https://*/*"]
  }
]
```

- [ ] **Step 4: Run the resource contract tests**

Run:

Working directory: `extension`.

```bash
rtk npm test -- manifest.test.ts translation-sheet.test.ts
rtk npm run typecheck
```

Expected at this intermediate checkpoint: manifest and CSS-source assertions pass; typecheck fails only because `translation-sheet.ts` still imports the deleted TypeScript module. Task 2 removes that import immediately.

- [ ] **Step 5: Keep Task 1 changes uncommitted until Task 2 is green**

The stylesheet move and runtime link implementation form one buildable unit. Do not create a commit with a deliberately broken TypeScript import.

---

### Task 2: Gate TranslationSheet rendering on external stylesheet load

**Files:**

- Modify: `extension/tests/translation-sheet.test.ts`
- Modify: `extension/src/translation-sheet.ts`
- Include uncommitted files from Task 1.

**Interfaces:**

- Consumes: packaged resource name `translation-sheet.css`.
- Produces:

```ts
constructor(
  documentRoot: Document,
  callbacks: TranslationSheetCallbacks,
  stylesheetUrl?: string,
)
```

- Produces internal URL resolution from `browser.runtime.getURL()` with `chrome.runtime.getURL()` fallback and `undefined` on unavailable/throwing runtimes.

- [ ] **Step 1: Add deterministic stylesheet helpers to the sheet tests**

Use one safe test URL and explicit events:

```ts
const stylesheetUrl =
  "safari-web-extension://taptranslate-test/translation-sheet.css";

function requiredStylesheet(): HTMLLinkElement {
  const link = requiredShadowRoot().querySelector(
    'link[rel="stylesheet"][data-taptranslate-stylesheet]',
  );
  if (!(link instanceof HTMLLinkElement)) {
    throw new Error("Missing translation sheet stylesheet");
  }
  return link;
}

function loadStylesheet(): void {
  requiredStylesheet().dispatchEvent(new Event("load"));
}

function renderReady(
  sheet: TranslationSheet,
  state: TranslationViewState,
): void {
  sheet.render(state);
  loadStylesheet();
}
```

Pass `stylesheetUrl` as the third constructor argument in `createSheet()`.

- [ ] **Step 2: Write failing external-link and latest-state tests**

Replace the initial mount expectation with:

```ts
sheet.render(loadingState);
const host = requiredHost();
const shadowRoot = requiredShadowRoot();
const stylesheet = requiredStylesheet();

expect(stylesheet.href).toBe(stylesheetUrl);
expect(shadowRoot.querySelector("style")).toBeNull();
expect(shadowRoot.querySelector('[role="dialog"]')).toBeNull();

sheet.render(successState);
loadStylesheet();

expect(shadowRoot.textContent).toContain("turn off");
expect(shadowRoot.textContent).not.toContain("Переводим выражение…");
expect(requiredStylesheet()).toBe(stylesheet);
```

Add a test that dispatches `error`, expects the host and keydown listener removed, confirms a later success for the same `request` does not remount, then renders a state with a distinct request object and expects one new pending link. Assert neither retry/dismiss callbacks nor `console.error` run.

Add late-event coverage: detach the pending host, render again, dispatch `load` on the stale link, and assert the replacement root still has no overlay until its own link loads.

- [ ] **Step 3: Run the sheet suite to verify red**

Run:

Working directory: `extension`.

```bash
rtk npm test -- translation-sheet.test.ts
```

Expected: FAIL because the current implementation creates inline `<style>` and renders synchronously.

- [ ] **Step 4: Replace inline style state with link lifecycle state**

Remove the style-string import. Add these fields:

```ts
private readonly stylesheetUrl: string | undefined;
private stylesheetElement: HTMLLinkElement | undefined;
private overlayElement: HTMLElement | undefined;
private stylesheetReady = false;
private failedStylesheetRequest: TranslationRequest | undefined;
```

Import `TranslationRequest` as a type. Extend the constructor and update `render`:

```ts
public constructor(
  documentRoot: Document,
  callbacks: TranslationSheetCallbacks,
  stylesheetUrl?: string,
) {
  this.documentRoot = documentRoot;
  this.callbacks = callbacks;
  this.stylesheetUrl = stylesheetUrl;
}

public render(state: TranslationViewState): void {
  const requestChanged = this.currentState?.request !== state.request;
  this.currentState = state;
  if (requestChanged) {
    this.failedStylesheetRequest = undefined;
  }
  if (this.failedStylesheetRequest === state.request) {
    return;
  }
  this.ensureMounted();
  this.renderCurrentState();
}
```

- [ ] **Step 5: Implement safe WebExtension URL resolution**

Add exact local types and a fail-closed resolver:

```ts
interface WebExtensionRuntime {
  getURL(path: string): string;
}

interface WebExtensionGlobal {
  readonly browser?: { readonly runtime?: WebExtensionRuntime };
  readonly chrome?: { readonly runtime?: WebExtensionRuntime };
}

function getExtensionStylesheetUrl(): string | undefined {
  const extensionGlobal = globalThis as typeof globalThis & WebExtensionGlobal;
  const runtime =
    extensionGlobal.browser?.runtime ?? extensionGlobal.chrome?.runtime;
  try {
    return runtime?.getURL("translation-sheet.css");
  } catch {
    return undefined;
  }
}
```

`ensureMounted()` resolves `this.stylesheetUrl ?? getExtensionStylesheetUrl()`. If the result is missing or empty, set `failedStylesheetRequest` to the current request and return without creating a host.

- [ ] **Step 6: Implement mount, load, error, and overlay replacement**

Create the link before exposing overlay content:

```ts
const stylesheetElement = this.documentRoot.createElement("link");
stylesheetElement.rel = "stylesheet";
stylesheetElement.href = stylesheetUrl;
stylesheetElement.setAttribute("data-taptranslate-stylesheet", "");
stylesheetElement.addEventListener("load", this.handleStylesheetLoad, {
  once: true,
});
stylesheetElement.addEventListener("error", this.handleStylesheetError, {
  once: true,
});
```

Assign current mount fields before appending the link and connecting the host so a fast event can be validated against `this.stylesheetElement`.

Implement handlers and fail-closed cleanup:

```ts
private readonly handleStylesheetLoad = (event: Event): void => {
  if (event.currentTarget !== this.stylesheetElement) return;
  this.removeStylesheetListeners();
  this.stylesheetReady = true;
  try {
    this.renderCurrentState();
  } catch {
    this.failCurrentStylesheet();
  }
};

private readonly handleStylesheetError = (event: Event): void => {
  if (event.currentTarget !== this.stylesheetElement) return;
  this.failCurrentStylesheet();
};

private failCurrentStylesheet(): void {
  const failedRequest = this.currentState?.request;
  this.releaseMount();
  this.failedStylesheetRequest = failedRequest;
}
```

Change `renderCurrentState()` to require `stylesheetReady`, remove only `overlayElement`, append one new overlay after the link, and store it. Never call `replaceChildren()` with the link.

Update `isMountConnected()` and `releaseMount()` for `stylesheetElement`, `overlayElement`, `stylesheetReady`, and explicit handler removal. Update `destroy()` to clear `failedStylesheetRequest` while preserving the established focus and expansion semantics.

- [ ] **Step 7: Convert existing sheet tests to the async gate**

Use `renderReady(sheet, state)` for every initial render that needs overlay elements. For detached recovery, dispatch `load` on each replacement link before inspecting state. Keep the original assertions for text safety, accessibility, focus, expansion, idempotent destroy, one host, and balanced keydown listeners.

- [ ] **Step 8: Run focused verification**

Run:

Working directory: `extension`.

```bash
rtk npm test -- translation-sheet.test.ts manifest.test.ts
rtk npm run typecheck
rtk npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit the complete stylesheet boundary**

Working directory: repository root.

```bash
rtk git add extension/public/translation-sheet.css extension/public/manifest.json extension/src/translation-sheet.ts extension/tests/manifest.test.ts extension/tests/translation-sheet.test.ts
rtk git add -u -- extension/src/translation-sheet-styles.ts
rtk git commit -m "fix(extension): load sheet styles outside page CSP"
```

---

### Task 3: Preserve end-to-end mock behavior behind the style gate

**Files:**

- Modify: `extension/tests/content.test.ts`

**Interfaces:**

- Consumes: `new TranslationSheet(document, callbacks, stylesheetUrl)` and link marker `[data-taptranslate-stylesheet]`.
- Produces: deterministic content-level loading/success and repeated-interaction coverage with no real stylesheet fetch.

- [ ] **Step 1: Add a content-test stylesheet loader**

```ts
const stylesheetUrl =
  "safari-web-extension://taptranslate-test/translation-sheet.css";

function loadMountedSheetStylesheet(): ShadowRoot {
  const host = document.querySelector("[data-taptranslate-sheet-host]");
  const shadowRoot = host?.shadowRoot;
  const link = shadowRoot?.querySelector(
    'link[rel="stylesheet"][data-taptranslate-stylesheet]',
  );
  if (shadowRoot === null || shadowRoot === undefined) {
    throw new Error("Missing translation sheet shadow root");
  }
  if (!(link instanceof HTMLLinkElement)) {
    throw new Error("Missing translation sheet stylesheet");
  }
  link.dispatchEvent(new Event("load"));
  return shadowRoot;
}
```

Pass `stylesheetUrl` to both real `TranslationSheet` instances in this file.

- [ ] **Step 2: Update integration assertions to prove no flash**

In the delayed-success test, click eligible content, assert the pending Shadow Root has no dialog text, dispatch stylesheet `load`, then assert loading. Advance the mock timer and assert success without another link or network request.

In the 20-cycle stress test, dispatch one stylesheet `load` after each cycle's first eligible click. Keep assertions for one host during replacement, zero hosts after dismissal, zero timers, no fetch, and balanced keydown listeners.

- [ ] **Step 3: Run focused integration tests**

Run:

Working directory: `extension`.

```bash
rtk npm test -- content.test.ts translation-sheet.test.ts manifest.test.ts
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit integration adaptation**

Working directory: repository root.

```bash
rtk git add extension/tests/content.test.ts
rtk git commit -m "test(extension): cover async sheet stylesheet loading"
```

---

### Task 4: Record the regression and verify the built extension

**Files:**

- Modify: `docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md`
- Review all changes from `origin/master` and from the pre-fix commit.

**Interfaces:**

- Consumes: user-supplied L2 screenshots dated 2026-07-27.
- Produces: durable regression evidence and a manual Safari retest gate.

- [ ] **Step 1: Record L2 without inventing environment details**

Change L2 to:

```markdown
| L2 | Local restrictive-CSP fixture | `http://127.0.0.1:5173/hardening-csp.html` | 2026-07-27 / Safari version pending | Pass: ordinary word; controls remain page-native | Regression: mock result renders without sheet styling | Regression: compact/expanded styling unavailable | Not run | Not run | Pass from supplied screenshots | Safari refuses sheet-owned inline stylesheet; translation network not observed | Regression | External stylesheet fix in MR #5; exact environment and retest pending |
```

Replace the empty findings row with:

```markdown
| Safari blocks the inline Shadow DOM stylesheet under `style-src 'none'` | L2; screenshots supplied 2026-07-27 | Packaged external stylesheet via WebExtension URL; manual retest pending | `2026-07-27-safari-csp-stylesheet-design.md`; focused sheet/manifest tests |
```

- [ ] **Step 2: Run the complete gate**

Run:

Working directory: `extension`.

```bash
rtk npm run check
```

Expected: formatting, lint, strict typecheck, all tests, and Safari/iOS 15.4 build pass.

- [ ] **Step 3: Inspect built resource and CSP-sensitive bundle hygiene**

Run:

Working directory: repository root.

```bash
rtk ls -l extension/dist/translation-sheet.css
rtk rg -n "taptranslate-shimmer|data-taptranslate-stylesheet|translation-sheet.css" extension/dist
rtk git diff --check
rtk git diff --stat origin/master...HEAD
rtk git status --short
```

Expected:

- `dist/translation-sheet.css` exists and contains `taptranslate-shimmer`;
- `dist/content.js` references `translation-sheet.css` and the link marker;
- `dist/content.js` does not contain the `taptranslate-shimmer` CSS body;
- no dependency files, background scripts, permissions, or unintended files changed;
- the worktree is clean after the final docs commit.

- [ ] **Step 4: Perform a line-by-line review**

Confirm:

- no `<style>` element or runtime CSS string remains;
- no host-page-relative URL fallback exists;
- pending links reveal no overlay;
- loaded links are never reinserted on view updates;
- error and stale events are contained without private logging;
- distinct-request retry and detached recovery cannot duplicate resources;
- normal destroy still restores focus conditionally;
- manifest matches remain HTTP(S), top-frame-only, and permission-free;
- all old sheet behavior remains covered after explicit `load`.

If review finds a defect, add one focused failing regression, fix only that defect, rerun `npm run check`, and commit as `fix(extension): address CSP stylesheet review`.

- [ ] **Step 5: Commit acceptance evidence**

Working directory: repository root.

```bash
rtk git add docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md
rtk git commit -m "docs: record Safari CSP regression"
```

- [ ] **Step 6: Push and update MR #5**

Working directory: repository root.

```bash
rtk git push origin feature/mock-frontend-hardening
rtk gh pr comment 5 --body "Implemented the Safari CSP stylesheet fix with a packaged web-accessible CSS resource. Automated checks pass; L2 must be rerun in desktop Safari before Stage 5 completion."
```

Do not mark L2 or Stage 5 complete until the user confirms the styled sheet under `style-src 'none'` and supplies the exact Safari/macOS versions.
