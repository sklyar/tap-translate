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

Run of 2026-11-08: `qwen3.8-flash` on Alibaba Cloud Model Studio, Singapore region, requests from Belgrade. 54 samples from Project Gutenberg, Go, MDN, and Kubernetes documentation, NASA news, Wikinews, and Wikipedia. Prices: $0.15 per 1M input tokens and $0.47 per 1M output tokens.

| Variant                | Valid answers | p50    | p95    | Input tokens | Output tokens | USD per 1,000 taps | Correct / partly / wrong |
| ---------------------- | ------------- | ------ | ------ | ------------ | ------------- | ------------------ | ------------------------ |
| sentence, thinking off | 54/54         | 1.24 s | 1.69 s | 332          | 84            | 0.09               | 45 / 7 / 2               |
| block, thinking off    | 54/54         | 1.25 s | 1.69 s | 436          | 86            | 0.11               | 47 / 5 / 2               |
| full, thinking off     | 54/54         | 1.24 s | 1.73 s | 575          | 84            | 0.13               | 51 / 3 / 0               |
| sentence, thinking on  | 54/54         | 4.44 s | 14.5 s | 368          | 513           | 0.30               | not rated                |
| block, thinking on     | 54/54         | 4.87 s | 17.8 s | 472          | 688           | 0.39               | not rated                |
| full, thinking on      | 54/54         | 5.83 s | 14.3 s | 611          | 607           | 0.38               | not rated                |

The quality columns are a first manual assessment against the expected meanings in `eval/sources.json`. A native Russian speaker has not reviewed them yet.

Conclusions so far:

- Without thinking, `qwen3.8-flash` is a candidate: p50 1.2 s, p95 1.7 s, and about $0.13 per 1,000 taps with the full context.
- Thinking is not usable for a tap: it is about 4 times slower, p95 is 14–18 s, the slowest answer took 56 s, and the cost is 3 times higher.
- The full context (the focus block and its neighbors) gives the best quality at the same latency. Only the full context translated `the old bean` as «голова» and `fall through` in Go as «проваливание». A typical tap sends about 1,000 characters; the largest sample has 3,400.
- The order of the properties in the JSON Schema matters: the model writes the fields in that order. An earlier run sent the properties in alphabetical order, with `explanation` first, and the model often left the explanation empty: up to 6% of the answers without thinking and 23% with thinking. Keep `explanation` last.
- A strict JSON Schema does not limit lengths (Qwen ignores `minLength`), and earlier runs had translations of 142 and 788 characters. The backend must validate each answer and retry or return an error.
- The prompt needs work. Explanations are long for a phone: the median is 165 characters, and they often start with «В данном контексте». Sometimes an English word gets into the translation («брать на себя, undertaking»), and sometimes the translation is a calque («пустить ноги в бега»).

Defects in the extension found while capturing:

- Hit-testing drops a tap between two letters. WebKit returns character rectangles rounded to whole pixels, so neighbor letters overlap by 1 px. When the point hits two characters, `findTextHitAtPoint` returns `null`, and the tap does nothing or closes the sheet. About 22% of the points over letters fail. Fix: #12.
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
