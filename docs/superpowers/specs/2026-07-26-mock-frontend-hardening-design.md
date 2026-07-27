# Mock Frontend Hardening Design

Related: [product roadmap](2026-07-26-taptranslate-product-roadmap-design.md), [Detection & Context Engine design](2026-07-26-detection-context-engine-design.md), [Mock Translation Provider design](2026-07-26-mock-translation-provider-design.md), and [Mobile-First Translation Sheet design](2026-07-26-mobile-first-translation-sheet-design.md).

## Goal

Demonstrate that the complete mock frontend remains correct and non-disruptive outside the controlled acceptance fixture before introducing an iOS container or real backend.

This stage hardens the existing flow rather than adding product capability:

```text
page interaction
    -> DetectionResult
    -> TranslationController
    -> MockTranslationProvider
    -> TranslationSheet
```

Public websites are discovery and manual-acceptance inputs. Every defect fixed in this stage must first receive a minimal deterministic local reproduction unless it is demonstrably specific to Safari and cannot be represented by the current test environment.

## Scope

This stage includes:

- deterministic hostile-page and repeated-interaction coverage;
- dynamic DOM and detached-host recovery;
- a bounded manual desktop Safari matrix across representative page categories;
- explicit top-document, navigation, and resource-lifecycle policies;
- fixes for reproducible defects found within those boundaries;
- documented limitations that require a later architecture or platform stage.

This stage excludes:

- Xcode, the iOS simulator, physical-device testing, touch gesture policy, and native packaging;
- a backend adapter, HTTP, real translation, background scripts, storage, analytics, or settings;
- iframe translation, `all_frames` injection, cross-origin frame coordination, and frame messaging;
- `MutationObserver`, History API patching, router integration, polling, scroll handlers, or resize handlers;
- automated crawling of public sites, screenshot-golden infrastructure, and timing-based performance budgets;
- new production or development dependencies.

## Approach

The implementation is fixture-first:

1. Add local pages that reproduce hostile CSS, dynamic content, long content, fixed overlays, iframe boundaries, and Content Security Policy behavior.
2. Add deterministic jsdom stress and lifecycle tests around the existing detection, controller, sheet, and content boundaries.
3. Exercise representative public pages manually in desktop Safari.
4. Reduce each material public-site defect to a local fixture or focused regression test before changing production behavior.
5. Record unsupported cases rather than expanding the architecture without a new design decision.

Public URLs never become automated test dependencies. No test requires internet access.

## Runtime behavior

### Detached sheet host

`TranslationSheet` treats a retained but disconnected host as a lost mount. On the next `render()` it:

- removes the stale document `keydown` listener;
- discards the stale host, shadow-root, and style references;
- mounts a new host and open shadow root;
- preserves the current compact/expanded choice and translation view state;
- does not restore or recapture page focus during this internal recovery;
- never leaves more than one TapTranslate host or sheet-owned keydown listener.

A normal `destroy()` still resets presentation mode and performs the previously designed conditional focus restoration.

### Page lifecycle

The content interaction installs one `pagehide` listener on `document.defaultView` when a window exists. `pagehide` calls `controller.dismiss()` to abort an active request and remove the sheet.

The capture-phase click listener remains installed so a document restored from Safari's back-forward cache continues to work. The content interaction's explicit cleanup removes both its click and `pagehide` listeners and dismisses the controller exactly once.

TapTranslate does not observe or patch SPA navigation. Content inserted or replaced by an SPA remains eligible because detection runs against the current DOM for every click. An already open sheet is not bound to its source node and remains open until replacement, an external ineligible click, close, Escape, or `pagehide`.

### Frame policy

Only the top-level document is supported. The content-script manifest explicitly declares `all_frames: false`. Text inside iframe documents is a manual negative case and must not produce a sheet in the top document.

No frame messaging or iframe-specific runtime branch is added.

## Hardening fixtures

### Hostile and dynamic page

`tests/fixtures/hardening.html` is a standalone manual Safari fixture containing:

- global `box-sizing`, typography, element, button, heading, paragraph, and mark rules, including selected `!important` declarations;
- light and dark page regions;
- a long scrollable article with deeply nested inline formatting;
- sticky navigation and a fixed overlay with a high page-local z-index;
- ordinary page links, buttons, inputs, and a page-event counter;
- a control that replaces a reading block after the content script has loaded;
- a control that removes the TapTranslate host to exercise recovery;
- long English strings for wrapping and internal-scroll checks;
- a same-origin iframe whose text remains outside the supported interaction boundary.

Fixture controls exist only under `tests/fixtures` and are not shipped in the extension bundle.

### CSP page

`tests/fixtures/hardening-csp.html` uses a restrictive CSP through a document meta element and minimal unstyled content. It is a manual Safari probe for whether the extension-created shadow `<style>` remains effective under page CSP.

The CSP result is recorded before choosing a remedy. If actual Safari extension injection blocks the shadow stylesheet, the remedy requires a focused design update because manifest CSS cannot directly replace shadow-root styling without changing the presentation boundary.

## Deterministic automated coverage

Tests extend the existing suites rather than creating a general browser-testing framework.

### Sheet lifecycle

- A connected host and shadow root are reused.
- A host removed by page code is remounted on the next render.
- Recovery preserves compact/expanded state and current rendered data.
- Recovery does not duplicate document keydown listeners.
- Repeated render, detach, recover, and destroy cycles leave no host behind.
- Page-global style nodes are never created.
- Long and markup-shaped provider strings remain text nodes and wrap through the sheet's existing CSS.

### Content and page lifecycle

- Dynamically inserted eligible text is detected without restarting the content interaction.
- `pagehide` dismisses the current request and sheet.
- A persisted `pagehide` does not remove the click listener.
- Explicit cleanup removes click and `pagehide` listeners once and is idempotent.
- A later click after cleanup performs no detection or dismissal.
- Events inside the sheet remain excluded from detection while ordinary page events continue.

### Stress and concurrency

- A burst of eligible requests can resolve out of order but only the latest result renders.
- Eligible and ineligible clicks alternate without leaving multiple hosts.
- Repeated open, success, expand, replace, and dismiss cycles leave no active timer, host, or sheet-owned listener.
- Cancellation remains silent and provider/page data never enters logs.

Stress tests use fixed iteration counts and fake timers. They assert final state and resource counts, not elapsed milliseconds, heap size, or browser-dependent layout timing.

### Manifest policy

A focused manifest test reads the committed JSON and asserts the existing content-script entry remains `document_idle`, matches HTTP and HTTPS pages, and explicitly sets `all_frames` to `false`.

## Manual desktop Safari matrix

The implementation creates `docs/superpowers/acceptance/2026-07-26-mock-frontend-hardening.md` as the durable checklist and result record. Stage 5 cannot be marked complete while required rows in that record remain unexecuted.

The acceptance record contains one row for each category:

1. long-form article;
2. technical documentation;
3. news page;
4. dynamically rendered SPA;
5. page with sticky or fixed overlays;
6. page with complex typography and nested inline markup.

Each row records:

- the concrete URL;
- test date and Safari version;
- detection and rejection results;
- loading and fixed mock success;
- compact/expanded behavior and internal scrolling;
- rapid replacement and dismissal;
- page scroll and viewport resize;
- continued behavior of page links, buttons, and controls;
- console and network observations;
- pass, documented limitation, or regression-fixture reference.

The two local hardening fixtures are additional required rows. Public-site content and behavior are expected to change, so the recorded URL is evidence for that run rather than a permanent automated contract.

## Resource and performance invariants

TapTranslate adds no observers or continuous work. At runtime:

- one passive capture-phase document click listener exists for the content interaction;
- one window `pagehide` listener exists when a window is available;
- at most one document keydown listener exists while the sheet is mounted;
- at most one TapTranslate host exists;
- at most one provider request is current;
- one click performs one detection pass and starts at most one translation request;
- scroll and resize perform no TapTranslate work.

Automated tests verify observable counts where platform APIs permit. Timing thresholds and heap assertions are excluded because they are unstable in jsdom and do not represent Safari.

## Failure, privacy, and compatibility

- Provider failures continue to render the neutral error state.
- `AbortError` remains silent.
- Unexpected interaction failures emit only the existing fixed TapTranslate message.
- Test diagnostics never add production logging of requests, results, targets, or page text.
- No request, result, or page content is persisted or transmitted.
- New runtime code uses APIs available in Safari 15.4 and iOS 15.4.
- The full extension remains strict TypeScript and native ESM with the current toolchain.

## Verification gate

Before completion:

1. focused hardening tests pass;
2. `npm run check` passes without dependency changes;
3. the production bundle contains no test controls or fixture code;
4. the complete manual desktop Safari matrix is exercised;
5. every fixed defect has a deterministic regression;
6. remaining limitations are written in the acceptance record.

The next stage is the first iOS checkpoint: create the Xcode container and exercise the complete mock vertical slice in the simulator and on a physical iPhone.
