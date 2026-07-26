# Mobile-First Translation Sheet Design

Related: [product roadmap](2026-07-26-taptranslate-product-roadmap-design.md), [Detection & Context Engine design](2026-07-26-detection-context-engine-design.md), and [Mock Translation Provider design](2026-07-26-mock-translation-provider-design.md).

## Goal

Build the first complete mock frontend vertical slice:

```text
page click
    -> DetectionResult
    -> TranslationRequest
    -> TranslationProvider
    -> loading / success / error bottom sheet
```

The presentation is mobile-first and follows the supplied dark bottom-sheet reference. It must remain isolated from host-page styles and behavior, support replacement, retry, cancellation, dismissal, scroll, resize, and keyboard access, and continue to target Safari 15.4 and iOS 15.4.

This is a production-shaped interaction component, not a temporary debug panel, but final branding and broad dictionary functionality remain outside this stage.

## Scope

This stage includes:

- one responsive bottom-sheet presentation used on mobile and desktop;
- two discrete presentation modes: compact and expanded;
- loading, success, and error rendering;
- translation request orchestration with retry, replacement, cancellation, and stale-result protection;
- non-modal external-click behavior;
- open Shadow DOM isolation;
- accessibility, reduced-motion behavior, and safe-area layout;
- pure controller tests, jsdom presentation tests, integration tests, and desktop Safari acceptance.

This stage excludes:

- free dragging, swipe-to-dismiss, velocity tracking, and snap gestures;
- a desktop anchored popover or anchor-based positioning;
- pronunciation, audio, frequency, related words, etymology, alternatives, definitions, examples, synonyms, editing, or personal dictionaries;
- a backend adapter, HTTP, background scripts, storage, analytics, Xcode, or iOS packaging;
- automatic retry, retry backoff, a DI framework, event bus, or generic state-machine library;
- final visual branding and broad real-site hardening.

## Responsive layout

TapTranslate uses the same bottom-sheet pattern at every viewport size. There is no separate desktop component or desktop positioning policy.

- The host covers the viewport with `position: fixed`, `z-index: 2147483647`, and `pointer-events: none`.
- The sheet is attached to the bottom edge.
- Below 768 CSS pixels it uses the full viewport width.
- At and above 768 CSS pixels it remains bottom-centered with a 640-pixel maximum width.
- Mobile bottom padding includes `env(safe-area-inset-bottom)`.
- Compact mode is content-sized with a 52vh maximum height.
- Expanded mode uses `height: calc(100vh - 16px - env(safe-area-inset-top))`.
- Expanded content scrolls inside the sheet; the page remains independently scrollable.
- Initial open uses compact mode. Retry and request replacement preserve the current compact/expanded choice.

The visible handle is a button rather than a drag target. Activating it toggles compact and expanded modes. Its accessible label and `aria-expanded` value reflect the current mode.

The backdrop is a low-opacity visual scrim and also has `pointer-events: none`, so page interaction continues through both the host and scrim. The sheet itself restores `pointer-events: auto`.

## Visual hierarchy

Compact success content is deliberately limited to data already present in `TranslationResult`:

1. handle and close button;
2. `expression`;
3. `partOfSpeech`;
4. primary `translation`;
5. short contextual `explanation`.

Expanded mode additionally displays the containing source sentence derived from `TranslationRequest.context.focusBlock`. The original clicked word, not the provider-selected expression, is highlighted using the existing word span. Neighbor blocks remain provider input and are not rendered.

The UI does not invent empty dictionary sections for fields the translation contract does not provide.

## Presentation states

No mounted sheet represents idle. A mounted sheet renders one of three translation states:

```ts
type TranslationViewState =
  | {
      readonly kind: "loading";
      readonly request: TranslationRequest;
    }
  | {
      readonly kind: "success";
      readonly request: TranslationRequest;
      readonly result: TranslationResult;
    }
  | {
      readonly kind: "error";
      readonly request: TranslationRequest;
    };
```

- Loading keeps the sheet geometry stable, renders a small skeleton, and announces a Russian loading message through a live region.
- Success renders the result and announces completion without moving focus.
- Error renders a neutral Russian failure message plus a retry button. Raw `Error.message` values and page text are never logged or displayed.
- `AbortError` is silent: cancellation never transitions to error.
- Replacement changes the existing sheet back to loading without a close/reopen animation.

Compact/expanded mode is presentation state owned by the sheet, not part of the translation request state. It survives retry and replacement and resets only after a full dismiss and later reopen.

## Component boundaries

The implementation remains three focused units plus the browser entry point.

### Translation controller

`translation-controller.ts` owns:

- the current `TranslationRequest`;
- the current `AbortController`;
- provider invocation;
- retry using the same request;
- replacement with a new request;
- dismissal;
- stale-result suppression;
- transitions among loading, success, error, and idle.

It depends only on `TranslationProvider` and a small view interface. It contains no DOM queries and is tested without jsdom.

```ts
interface TranslationView {
  render(state: TranslationViewState): void;
  destroy(): void;
}
```

`render()` mounts the view on first use and updates it thereafter. `destroy()` is idempotent and removes the host plus view-owned listeners. UI callbacks are supplied when the concrete sheet is created and delegate retry or dismissal back to the controller.

Each provider call captures its own `AbortController`. A completion updates the view only when that controller is still the controller owned by the current request. Starting a replacement or retry aborts the previous controller before starting the next call. Dismissal aborts the current controller, clears controller state, and unmounts the view.

### Translation sheet

`translation-sheet.ts` owns:

- one host element appended to `document.documentElement`;
- an open shadow root;
- loading, success, and error DOM rendering;
- compact/expanded presentation state;
- retry, expand/collapse, close, and Escape callbacks;
- safe mount, update, and destroy behavior;
- live-region announcements and focus restoration.

It does not call detection or a translation provider.

### Shadow styles

`translation-sheet-styles.ts` exports the stylesheet text inserted into one `<style>` element in the shadow root. A separate module keeps the renderer readable without requiring CSS imports, constructable stylesheets, CSS frameworks, or runtime dependencies.

### Content entry point

`content.ts` remains the composition root:

- instantiate the configured mock provider;
- create the sheet and controller;
- convert successful detection results with `createTranslationRequest()`;
- ignore click events whose composed path contains the TapTranslate host;
- replace the active request for a new eligible word;
- dismiss an open sheet for an external ineligible click;
- preserve the existing passive capture-phase page listener.

No handler calls `preventDefault()` or `stopPropagation()`.

## External interaction policy

The sheet is intentionally non-modal even though it visually resembles a modal bottom sheet.

- The page remains pointer-interactive and scrollable behind the sheet.
- Clicking a different eligible word replaces the request immediately.
- Clicking an ineligible page target dismisses the sheet while the site's original click continues normally.
- Clicking a control inside the shadow tree never starts detection or external dismissal.
- Escape dismisses an open sheet without stopping propagation.
- Scroll and resize require no repositioning because the sheet stays fixed to the viewport.

This policy avoids modifying `body.style`, locking page scroll, or preventing the user from continuing to read and translate.

## Accessibility

- The sheet container uses `role="dialog"`, `aria-labelledby`, and no `aria-modal="true"`.
- The component does not trap focus or automatically move focus when opened.
- Close, retry, and handle controls are native buttons with Russian accessible labels.
- A polite live region announces loading, success, and failure states without exposing surrounding page context.
- On first open, the view records the previously focused element when it is focusable.
- Dismissal restores that element only when focus ended inside the sheet and the saved element remains connected and focusable.
- Sentence highlighting uses semantic `<mark>` without changing the source string.
- Russian controls and status text use `lang="ru"`; the English expression and source sentence use `lang="en"`.
- Text and controls meet WCAG AA contrast targets.
- Keyboard focus is visibly styled.
- Motion uses short transform/opacity transitions and becomes effectively immediate under `prefers-reduced-motion: reduce`.

## Mock runtime wiring

The production content bundle for this stage uses `MockTranslationProvider` with:

- one successful attempt repeated indefinitely;
- a short artificial delay;
- a fixed demonstrational `turn off` result.

The local fixture includes the sentence `Turn the light off.` so the committed runtime scenario is internally consistent during manual acceptance. Clicking arbitrary words on other pages may show the fixed demonstration result; semantic accuracy is not a goal of the mock presentation stage.

Failure, retry, delayed failure, cancellation, and replacement are exercised with configured providers in automated tests. No developer control panel, page magic words, query-string switch, or test hook is shipped in the content bundle.

## Debug indicator retirement

The accepted-hit ring is removed from runtime wiring when the sheet is connected. Its source module and focused tests are deleted rather than retained as unused production code. Historical design and implementation documents remain unchanged.

## Failure and privacy behavior

- Expected provider failures produce only the user-facing neutral error state.
- Cancellation is silent.
- View construction or rendering failure must not break the host page.
- Unexpected entry-boundary failures may log one fixed TapTranslate message without the caught error object, request, target, translation, or page context.
- No translation request, result, or page text is persisted.
- No network request is performed.

## Automated testing

Pure controller tests cover:

- initial loading followed by success;
- initial loading followed by error;
- retry with the same request;
- replacement aborting the previous call;
- a stale success or failure being ignored;
- dismissal cancellation and unmount;
- `AbortError` remaining silent.

Jsdom sheet tests cover:

- one host and one open shadow root;
- loading, success, and error content;
- expression differing from the clicked word;
- source-sentence extraction and clicked-word highlighting;
- compact/expanded toggle and accessible labels;
- retry and close callbacks;
- Escape dismissal;
- live-region text;
- repeated mount/update/destroy without leaked DOM nodes or document listeners;
- focus restoration conditions;
- shadow-style presence and absence of page-global style nodes.

Integration tests cover:

- `DetectionResult` conversion and loading presentation;
- replacement with a second detection result;
- ineligible external click dismissal;
- a shadow-tree click being ignored by detection;
- preserved page events without `preventDefault()` or `stopPropagation()`;
- fixed mock success after artificial delay.

Layout geometry, CSS isolation against hostile styles, actual viewport safe areas, and browser focus behavior remain manual because jsdom does not implement Safari layout.

The full `npm run check` gate must pass with no new dependency.

## Desktop Safari acceptance

Load the rebuilt `extension/dist` in desktop Safari and use the local fixture.

Verify:

- compact loading and success for `Turn the light off.`;
- expression `turn off` while the clicked word remains `Turn`;
- expand/collapse and internal scrolling;
- close and Escape;
- replacement by another eligible word;
- dismissal by an ineligible or interactive page click without breaking that action;
- page scroll and resize while the sheet is open;
- a narrow responsive viewport and a normal desktop viewport;
- visible focus and reduced-motion behavior;
- no accepted-hit ring;
- no unexpected logs, network requests, or page-style leakage.

Error, retry, cancellation races, and stale-result suppression are mandatory automated acceptance and optional manual smoke checks through a locally adjusted mock configuration that is reverted before commit.

## Completion boundary

This stage is complete when the mock vertical slice works in desktop Safari, automated checks pass, and the stated interaction and accessibility behavior is covered.

The following stage hardens the complete mock frontend on representative real sites. The first iOS simulator and physical-device checkpoint follows that hardening stage, as defined by the product roadmap.
