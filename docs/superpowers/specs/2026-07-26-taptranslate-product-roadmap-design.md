# TapTranslate Product Roadmap Design

## Purpose

Define the implementation route from the existing desktop Safari word-detection prototype to a production Safari Web Extension that translates words with contextual explanations on iPhone.

## Delivery strategy

TapTranslate is mobile-first in product constraints and desktop-first in daily development. Shared TypeScript behavior is developed and tested primarily in desktop Safari, while planned iOS checkpoints catch touch, viewport, selection, and packaging differences before they can force a late redesign.

Each major stage receives its own design and implementation plan. The stages below describe sequencing and boundaries rather than serving as one monolithic implementation plan.

## Current baseline

The current `feature/safari-extension-prototype` branch contains strict TypeScript tooling, English word segmentation, Safari-compatible point-to-text hit-testing, a passive click content script, Manifest V3 configuration, and a deterministic Vite bundle. Automated formatting, linting, type-checking, unit tests, and production build all pass.

The prototype logs a detected English word and intentionally has no UI, context extraction, backend integration, background script, storage, or native application container.

## Architecture boundaries

- **Detection & Context Engine** decides whether a hit is eligible, identifies the exact word, derives sentence and paragraph boundaries, and produces a normalized translation context.
- **Safari DOM Adapter** converts viewport coordinates and page structure into text positions, geometry, visibility, and DOM-boundary information.
- **Interaction Adapter** translates desktop click and later mobile pointer or touch behavior into the same engine input without placing device-specific event types in the engine.
- **Presentation Layer** renders mock and real translation states in an isolated, responsive interface that works on wide and narrow viewports.
- **Translation Provider** exposes one frontend contract with a deterministic mock implementation first and a backend implementation later.
- **Native Containers** package the shared extension resources for macOS and iOS without becoming the home of web-extension business logic.

## Implementation stages

### 1. Accept the existing desktop prototype

Load `extension/dist` as a temporary extension in desktop Safari, verify word detection and rejection behavior on real webpages, close material prototype gaps, and merge the validated branch.

### 2. Build the Detection & Context Engine

Define eligibility rules for visible non-interactive text, harden exact-word detection across realistic DOM structures, extract sentence and paragraph context, and cover the behavior with pure tests, DOM fixtures, and a Safari acceptance matrix.

### 3. Introduce the mock translation contract

Define stable translation request and response types plus a provider interface whose deterministic mock supports success, delay, failure, retry, and cancellation scenarios without network access.

### 4. Build the mobile-first presentation layer

Render an isolated and accessible translation experience that adapts to desktop and mobile viewports while supporting idle, loading, success, error, replacement, dismissal, scroll, and resize behavior.

### 5. Harden the complete mock frontend

Exercise detection, context, provider, and UI behavior together on representative real sites, then address CSS isolation, dynamic layouts, performance, shadow DOM, frames, page navigation, and repeated interactions.

### 6. Run the first iOS checkpoint

Create the Xcode container from the shared extension resources and test the mock vertical slice in an iOS simulator and on a physical iPhone, focusing on touch events, scrolling, selection, zoom, safe areas, and viewport changes.

### 7. Build the backend and provider integration

Implement the Go API and translation-provider integration with explicit validation, timeouts, limits, privacy boundaries, and error contracts, then add the extension transport layer without changing presentation or context interfaces.

### 8. Stabilize the end-to-end product

Replace the mock in production wiring, retain it for tests and local development, and verify cancellation, slow or missing networks, backend failures, repeated requests, accessibility, and consistent desktop and iPhone behavior.

### 9. Prepare mobile distribution

Finish the containing application, onboarding, settings, signing, identifiers, privacy information, TestFlight workflow, App Store assets, and release acceptance on supported iPhone versions.

## Mobile checkpoints

The first lightweight iOS probe occurs after the Detection & Context Engine if desktop behavior reveals assumptions about event coordinates or page structure that need device confirmation. The first required iOS vertical-slice checkpoint occurs after the mock frontend is complete, and final device testing repeats after real backend integration.

Desktop remains the primary development loop between these checkpoints. The shared engine and presentation code must not depend on desktop-only input, hover, fixed mouse precision, or Node.js runtime APIs.

## First detailed plan boundary

The next design and implementation plan covers Stage 1 acceptance plus Stage 2 Detection & Context Engine. It includes element eligibility, point-to-character resolution, word detection, sentence and paragraph extraction, normalized context output, automated tests, DOM fixtures, and desktop Safari acceptance scenarios.

It excludes translation UI, mock provider behavior, backend calls, background scripts, storage, Xcode containers, and mobile gesture policy beyond preserving mobile-compatible interfaces.

## Progression rule

A stage advances only when its automated checks pass and its stated Safari acceptance scenarios have been exercised. If an iOS checkpoint exposes a shared-engine defect, the fix belongs in the shared TypeScript layer rather than in a native-platform workaround unless the behavior is demonstrably platform-specific.
