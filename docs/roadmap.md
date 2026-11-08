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
- evaluation of contextual translation: 54 captured samples in `eval/`, a capture script, and a Go command that runs a model on them (`backend/cmd/evaluate`);
- Go rules for `backend/`: the Uber Go Style Guide, strict golangci-lint, nilaway, package boundaries, and test rules (`backend/AGENTS.md`).

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

Prompt work of 2026-11-08: `qwen3.8-flash`, `full` context, thinking off, the samples captured again after the context fixes. The quality column is a manual assessment by the coding agent against `expected`, as for the first run. A native speaker has not reviewed it yet.

| Prompt                     | Temperature | p50    | p95    | Input tokens | Output tokens | USD per 1,000 taps | Explanation, median / max chars | Correct / partly / wrong |
| -------------------------- | ----------- | ------ | ------ | ------------ | ------------- | ------------------ | ------------------------------- | ------------------------ |
| old prompt                 | default     | 1.18 s | 1.82 s | 572          | 88            | 0.13               | 176 / 275                       | 47 / 7 / 0               |
| new prompt                 | 0           | 0.97 s | 1.76 s | 792          | 61            | 0.15               | 68 / 98                         | 49 / 5 / 0               |
| new prompt, a second run   | 0           | 0.95 s | 1.55 s | 792          | 60            | 0.15               | 67 / 102                        | not rated                |

What changed in the prompt and why:

- The explanation is one sentence of at most 100 characters. It says only what the translation does not: the shade of meaning, the register, the domain, or a warning about the usual meaning. The prompt bans the openings «В данном контексте», «В этом тексте», and «Здесь», and it gives three short examples. Now 0–2 of 54 explanations have two sentences (it was 48), and 3 start with «В данном контексте» or a similar phrase (it was 43). Instead, about 38 of 54 start with a label, as in the examples: «Разговорное:», «Термин программирования:», «Устойчивое выражение:». The review should decide if these labels are useful or if they are a new filler.
- The prompt says that most answers do not need a warning about the usual meaning. Without this line, 15–18 of 54 explanations had a contrast «а не …», often a made-up one, such as «а не бумага» for `cardboard`. With it, 8.
- The translation is in dictionary form (the infinitive, the nominative singular), in lowercase, without English words, and not a calque. A second variant is allowed only if it also fits the text.
- The expression must contain the tapped word and every word that the meaning depends on. The old prompt returned `soft landing` for a tap on `touchdowns`.
- Temperature 0 makes the answers more stable. In two runs of the same prompt, the translation was the same for 20 of 54 samples with the default temperature, 31 with 0.2, and 37 with 0. An answer to the same tap should not change from one tap to the next.
- The prompt is longer, so the input is 220 tokens larger and a tap costs about 15% more. The answer is 30% shorter, so the latency is about 0.2 s lower.

Errors that the prompt did not fix. They repeat in every run, so they look like limits of `qwen3.8-flash`: `carry on (a business)` gets the second variant «продолжать», `fall through` in Go becomes «проваливаться», `asset` (the telescope) becomes «актив», `right around the world` becomes «прямо по всему», and `come round` sometimes gets «идти на поправку». A stricter rule for the second variant did not fix `carry on` in two runs, so the prompt keeps the simpler rule.

Defects in the extension found while capturing:

- Hit-testing drops a tap between two letters. WebKit returns character rectangles rounded to whole pixels, so neighbor letters overlap by 1 px. When the point hits two characters, `findTextHitAtPoint` returns `null`, and the tap does nothing or closes the sheet. About 22% of the points over letters fail. Fix: #12.
- Inline `<code>` was removed from the context text: "run `gofmt`; if the answer" became "run ; if the answer". Fixed: the context text now keeps inline code.
- Wikipedia citation marks moved sentence boundaries: a sentence could start with "103] As with". Fixed: the context text now drops footnote references such as `<sup>[103]</sup>`.

Still required: a review of the new prompt's report by a native speaker, and a comparison with 1–2 other models.

### 3. Backend and transport

- Go API with request validation, size limits, timeouts, and a stable error contract.
- Privacy boundary: which page text leaves the device and how long it is kept (not kept by default). Logs never contain page text.
- Client identification and rate limits, so that nobody can use the API as a free LLM proxy.
- Cache for repeated requests.
- HTTP provider in the extension that implements `TranslationProvider`. The request goes from the extension context, not from the page context. The mock provider stays for tests and local development.
- API tests with golden JSON fixtures. The expected JSON marks unknown values (IDs, time) with `<<PRESENCE>>` of `github.com/kinbiko/jsonassert`, and the test puts known values into the fixture as template values. A failure shows the path to the field and a diff of the formatted JSON.

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
