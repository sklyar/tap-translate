# Safari CSP Stylesheet Design Addendum

Related: [Mock Frontend Hardening Design](2026-07-26-mock-frontend-hardening-design.md), [Mobile-First Translation Sheet Design](2026-07-26-mobile-first-translation-sheet-design.md), and [desktop Safari acceptance record](../acceptance/2026-07-26-mock-frontend-hardening.md).

## Evidence and root cause

The restrictive-CSP fixture reproduces a Safari-specific presentation failure:

- detection, request mapping, mock translation, and Shadow DOM creation succeed;
- the complete translation markup is present in the open Shadow Root;
- the sheet is rendered with browser-default HTML styles;
- Safari reports that the stylesheet was refused because its hash, nonce, or `unsafe-inline` is absent from `style-src`.

`TranslationSheet` currently creates a `<style>` element, assigns the CSS through `textContent`, and appends it to the Shadow Root. Safari applies the host page's CSP to this extension-created inline stylesheet and ignores it. Repeated view renders can produce repeated CSP reports because the same blocked style element is reinserted with the overlay; this is not evidence of duplicate content-script listeners.

This behavior matches open WebKit bug [291734](https://bugs.webkit.org/show_bug.cgi?id=291734). A WebKit engineer recommends loading a packaged extension stylesheet into the Shadow Root and exposing that file through Manifest V3 `web_accessible_resources`.

## Decision

Keep the existing Shadow DOM presentation boundary and replace the inline `<style>` with one external `<link rel="stylesheet">` whose URL comes from the Safari Web Extension runtime.

The shipped resource is named `translation-sheet.css`. It is copied unchanged into `extension/dist` and declared as web-accessible for the same HTTP and HTTPS matches as the content script. `TranslationSheet` resolves the URL with `browser.runtime.getURL("translation-sheet.css")`; a `chrome.runtime.getURL` fallback keeps the boundary compatible with other WebExtension hosts without introducing a dependency.

The optional constructor stylesheet URL exists only as a narrow test seam. Production composition does not pass it and therefore always uses the extension runtime URL. If neither WebExtension runtime exists and no explicit test URL was supplied, the sheet fails closed rather than resolving a page-relative URL that a host page could control.

The constructor signature becomes:

```ts
constructor(
  documentRoot: Document,
  callbacks: TranslationSheetCallbacks,
  stylesheetUrl?: string,
)
```

This decision does not add a background script, `scripting` permission, dynamic CSS injection, light-DOM UI, a second renderer, or a production dependency.

## Alternatives rejected

### Manifest CSS with light-DOM markup

Manifest-declared CSS can style page content without an inline style element, but it cannot cross the Shadow DOM boundary. Moving the sheet into light DOM would discard the isolation already proven against hostile page CSS and require pervasive high-specificity rules. This is a larger and less reliable architecture change.

### `browser.scripting.insertCSS`

Safari supports CSS injection APIs, but injected document CSS still cannot style descendants inside a Shadow Root. Calling the API also requires tab identity, the `scripting` permission, and a background or extension-page coordination path, all outside this stage.

### Constructed stylesheets or CSSOM mutation

Constructed stylesheet support does not meet the Safari/iOS 15.4 floor, and CSSOM-generated rules are not a sound way to bypass a page's CSP. This would also preserve runtime-generated CSS instead of adopting the fixed packaged resource recommended for Safari extensions.

### Document the failure as a permanent limitation

An unstyled, page-flow translation UI is disruptive and unusable on strict-CSP sites. It is a Stage 5 regression, not an acceptable product limitation.

## Stylesheet load lifecycle

`TranslationSheet` retains a single host and open Shadow Root. A mount initially contains only the stylesheet link; no overlay markup is exposed until the current link fires `load`.

The lifecycle is:

1. `render(state)` stores the latest view state and ensures a mount exists.
2. The mount creates one external stylesheet link and registers one-shot `load` and `error` handlers before appending it.
3. While the stylesheet is pending, later loading/success/error renders replace only the stored state. No unstyled overlay is created.
4. On `load`, the sheet renders the latest stored state exactly once. Later view updates replace only the overlay and leave the loaded link in place.
5. On `error`, the sheet removes the host and its document keydown listener, clears mount references, and renders nothing. It emits no page/provider data and does not propagate an exception to the host page.
6. Provider completion for the same request after a stylesheet error remains invisible and does not create a retry loop.
7. A later distinct translation request or a normal `destroy()` clears the failed-load guard and may create one fresh mount attempt.

The async handlers act only when their event target is still the sheet's current link. A late event from a destroyed or replaced mount is ignored.

## Rendering and recovery

After stylesheet load, the current overlay is tracked separately from the link. Rendering removes the previous overlay and appends the replacement without reinserting or reloading the stylesheet.

Detached-host recovery remains unchanged in product semantics:

- the stale keydown listener and stylesheet handlers are removed;
- stale mount references are discarded;
- current state, compact/expanded mode, and original focus ownership are preserved;
- the replacement mount loads a fresh external stylesheet before revealing the latest overlay;
- no more than one host, stylesheet link, overlay, or sheet-owned keydown listener exists.

A normal `destroy()` still removes all presentation resources, resets expansion and stylesheet-failure state, and conditionally restores the page element focused before the initial mount.

## Resource packaging and manifest

`extension/public/translation-sheet.css` is the single CSS source. Vite copies it to `extension/dist/translation-sheet.css`; the TypeScript string module is removed so styles cannot drift between two representations.

The manifest adds:

```json
"web_accessible_resources": [
  {
    "resources": ["translation-sheet.css"],
    "matches": ["http://*/*", "https://*/*"]
  }
]
```

The existing content script remains `document_idle` and `all_frames: false`. No new permissions are required.

## Automated verification

Focused tests prove:

- the Shadow Root contains one external stylesheet link and no `<style>` element;
- the link uses the supplied extension resource URL;
- no overlay exists before stylesheet load;
- `load` renders the latest pending view state;
- later renders reuse the loaded link and replace only the overlay;
- `error` removes the invisible host and keydown listener without invoking callbacks or logging private data;
- a distinct later request can retry stylesheet loading, while provider completion for the failed request cannot;
- destroy and detached-host recovery remove stale link handlers and ignore late events;
- compact/expanded and focus behavior survive the async recovery boundary;
- the manifest exposes exactly the packaged stylesheet to HTTP and HTTPS pages;
- the committed CSS retains the responsive, isolation, and accessibility rules previously tested from the TypeScript string;
- the production build contains `translation-sheet.css` and contains no embedded copy of the full stylesheet in `content.js`.

jsdom does not evaluate CSP or load extension URLs, so tests dispatch deterministic `load` and `error` events. The restrictive-CSP result itself remains a manual Safari acceptance gate.

## Manual verification and completion

The existing L2 acceptance row will be recorded as a regression with the supplied screenshot evidence. The exact Safari and macOS versions must be added by the tester.

After implementation, repeat L2 and verify:

- the sheet is fully styled under `style-src 'none'`;
- the Shadow Root contains a `<link>` whose `href` uses the Safari extension scheme;
- no CSP violation refers to `translation-sheet.css` or sheet-owned inline style;
- Vite development-client CSP messages, if any, are distinguished from extension resource messages;
- loading, success, expand/collapse, close, Escape, and page controls continue to work;
- no translation network request occurs.

Stage 5 remains incomplete until L2 and the other required desktop Safari rows have recorded final outcomes.
