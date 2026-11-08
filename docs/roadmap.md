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
- CI that runs `npm run check` for each pull request.

Not done:

- there is no real translation; the extension uses the mock provider;
- the extension has never run on iOS;
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

### 2. Contextual translation prototype

This stage can run in parallel with stage 1.

Question: can an LLM give a good contextual translation fast enough and cheap enough for a tap?

- Collect 30–50 real `DetectionContext` samples from different kinds of pages: fiction, technical documentation, news, phrasal verbs, idioms, and ambiguous words.
- Compare 2–3 providers or models on translation quality, latency (p50 and p95), and cost per request.
- Find how much context the model really needs. Now the extension can send up to 8,000 characters per tap.

Result: a provider and model, a first prompt, and target values for latency and cost.

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
