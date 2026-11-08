# TapTranslate Roadmap

Updated: 2026-11-08.

## Goal

TapTranslate is a Safari Web Extension for iPhone. The user taps an English word on a web page and sees a Russian translation with a short explanation that fits the surrounding text.

Desktop Safari is the main development loop. iPhone is the target platform.

## Principle

Check the riskiest assumptions first. A stage that can change the architecture goes before work that polishes existing parts.

A stage is complete when `npm run check` passes and the manual check of the stage is done on the target device.

## Current status

Done:

- detection and context engine: point-to-character hit-testing, eligibility rules, word and sentence spans, focus block, and one neighboring block on each side;
- translation contract (`TranslationRequest`, `TranslationResult`, `TranslationProvider`) and a deterministic mock provider;
- mobile-first translation sheet in a Shadow DOM, styled by the packaged `translation-sheet.css`;
- hardening for hostile page CSS, restrictive CSP, page lifecycle, bfcache, and a removed sheet host;
- CI that runs `npm run check` for each pull request;
- evaluation of contextual translation: 54 captured samples in `eval/`, a capture script, and a Go command that runs a model on them (`backend/cmd/evaluate`).

Not done:

- there is no real translation; the extension uses the mock provider;
- the extension has run on iOS only in the Simulator, not on a physical iPhone;
- manual checks in desktop Safari covered only the restrictive-CSP fixture, and the CSP fix still needs a retest.

## Next stages

### 1. iOS probe

Question: does the current interaction model work on iPhone?

- Generate the Xcode container in `ios/` from `extension/dist`.
- In Simulator and on a physical iPhone, check that:
  - a tap on plain text delivers a `click` to the content script and opens the sheet;
  - links and other page controls keep working;
  - the expanded sheet stays inside the visible area when the Safari toolbars are shown (the sheet uses `100vh`);
  - text selection, zoom, and rotation do not break detection or the sheet.

Result: the model is confirmed, or there is a list of required changes. If a tap does not deliver a `click`, move the input handling to pointer or touch events before any other frontend work.

Simulator results (2026-11-08, iPhone 18 Pro, iOS 27.2):

- Confirmed: a tap on plain text opens the sheet, so the `click` reaches the content script and is trusted. Links work. A tap after a long-press selection clears the selection and opens the sheet. Rotation and dismissal work.
- Fixed: when the Safari toolbar was expanded, the expanded sheet went above the top of the screen. The cause was `100vh`; the sheet now sizes itself to the visual viewport.
- Fixed: with pinch zoom, the sheet scaled with the page and could move off the screen. The sheet now cancels the page zoom and stays at the bottom of the screen.
- Fixed: the sheet could not be dragged, and a drag on it scrolled the page. Now a drag anywhere on the compact sheet expands or closes it. On the expanded sheet, the content scrolls, and a drag down collapses the sheet when the content is at the top. A drag on the sheet never scrolls the page.
- Fixed: the collapsed floating Safari toolbar could cover the end of the sheet content. Touch devices now get extra bottom padding.
- Limitation: trackpad or mouse-wheel scrolling over the sheet (for example, on an iPad with a trackpad) can still scroll the page under it.

Still required: the same checks on a physical iPhone.

### 2. Contextual translation prototype

This stage can run in parallel with stage 1.

Question: can an LLM give a good contextual translation fast enough and cheap enough for a tap?

- Collect 30–50 real `DetectionContext` samples from different kinds of pages: fiction, technical documentation, news, phrasal verbs, idioms, and ambiguous words.
- Compare 2–3 providers or models on translation quality, latency (p50 and p95), and cost per request.
- Find how much context the model really needs. Now the extension can send up to 8,000 characters per tap.

Result: a provider and model, a first prompt, and target values for latency and cost.

The data and tools are in `eval/`; see [eval/README.md](../eval/README.md). The capture script runs the real detection code in WebKit, so the samples contain what the extension really sends.

First run (2026-11-08): `qwen3.8-flash` on Alibaba Cloud Model Studio, Singapore region, requests from Belgrade. 54 samples from Project Gutenberg, Go, MDN, and Kubernetes documentation, NASA news, Wikinews, and Wikipedia. Prices: $0.15 per 1M input tokens and $0.47 per 1M output tokens.

| Variant                | Valid answers | p50    | p95    | Input tokens | Output tokens | USD per 1,000 taps | Correct / partly / wrong |
| ---------------------- | ------------- | ------ | ------ | ------------ | ------------- | ------------------ | ------------------------ |
| sentence, thinking off | 51/54         | 1.34 s | 2.99 s | 332          | 98            | 0.10               | 41 / 9 / 4               |
| block, thinking off    | 52/54         | 1.36 s | 1.71 s | 436          | 95            | 0.11               | 42 / 8 / 4               |
| full, thinking off     | 54/54         | 1.33 s | 2.00 s | 575          | 94            | 0.13               | 46 / 7 / 1               |
| sentence, thinking on  | 42/54         | 4.36 s | 12.8 s | 368          | 525           | 0.30               | not rated                |
| block, thinking on     | 41/54         | 4.86 s | 11.3 s | 472          | 525           | 0.32               | not rated                |
| full, thinking on      | 42/54         | 4.93 s | 33.9 s | 611          | 755           | 0.45               | not rated                |

"Wrong" includes invalid answers. The quality columns are a first manual assessment against the expected meanings in `eval/sources.json`. A native Russian speaker has not reviewed them yet.

Conclusions so far:

- Thinking is not usable for a tap. It is 3–4 times slower, p95 reaches 34 s, and 23% of the answers are invalid, mostly with an empty explanation.
- Without thinking, `qwen3.8-flash` is a candidate: p50 1.3 s, p95 2.0 s, and about $0.13 per 1,000 taps with the full context.
- The full context (the focus block and its neighbors) gives the best quality at the same latency. A typical tap sends about 1,000 characters; the largest sample has 3,400.
- A strict JSON Schema does not guarantee non-empty fields (`minLength` is ignored), and one answer had a 788-character translation. The backend must validate each answer and retry or return an error.
- The prompt needs work. Explanations are long: the median is 213 characters, often 2–3 sentences that start with «В данном контексте». The model sometimes misses an idiom, for example `watch like a hawk` becomes «ястреб».

Defects in the extension found while capturing:

- Hit-testing drops a tap between two letters. WebKit returns character rectangles rounded to whole pixels, so neighbor letters overlap by 1 px. When the point hits two characters, `findTextHitAtPoint` returns `null`, and the tap does nothing or closes the sheet.
- Inline `<code>` is removed from the context text: "run `gofmt`; if the answer" becomes "run ; if the answer".
- Wikipedia citation marks move sentence boundaries: a sentence can start with "103] As with".

Still required: a review of the report by a native speaker, a shorter and stricter prompt with a new run, and a comparison with 1–2 other models.

### 3. Backend and transport

- Go API with request validation, size limits, timeouts, and a stable error contract.
- Privacy boundary: which page text leaves the device and how long it is kept (not kept by default). Logs never contain page text.
- Client identification and rate limits, so that nobody can use the API as a free LLM proxy.
- Cache for repeated requests.
- HTTP provider in the extension that implements `TranslationProvider`. The request goes from the extension context, not from the page context. The mock provider stays for tests and local development.

### 4. Tests with real layout

Run hit-testing and context extraction in WebKit through Playwright on the local fixture pages. These tests cover what jsdom cannot: layout, character geometry, and blockified flex and grid items.

### 5. End-to-end stabilization

- Check desktop Safari and iPhone on a short list of real sites.
- Check slow and missing network, backend errors, cancellation, repeated taps, and accessibility.

### 6. Container app and distribution

- Containing app: onboarding that shows how to turn on the extension, and settings.
- Signing, bundle identifiers, App Store privacy information, TestFlight, and App Store assets.
- Release check on all supported iOS versions.

## Open product decisions

- Who pays for translation requests: a free tier with limits, a subscription, or the user's own API key. This choice defines client identification in stage 3.
- The minimum supported iOS version. The build target is Safari and iOS 15.4 now.
- Language pairs other than English to Russian.
