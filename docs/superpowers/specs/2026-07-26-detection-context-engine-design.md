# Design Document — Detection & Context Engine

|                   |                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Created**       | 2026-07-26                                                                                                                                      |
| **Finished date** | Not finished                                                                                                                                    |
| **Status**        | DRAFT                                                                                                                                           |
| **Authors**       | Alexey Sklyar, Codex                                                                                                                            |
| **Approved by**   | Pending user review                                                                                                                             |
| **Epic**          | Not assigned                                                                                                                                    |
| **Related links** | [Product roadmap](2026-07-26-taptranslate-product-roadmap-design.md), [Desktop prototype design](2026-07-26-desktop-safari-prototype-design.md) |

**Audience:** TapTranslate frontend and backend engineering, QA, and product review

---

## Context

TapTranslate currently has a working desktop Safari prototype that resolves an exact English word under a page click and logs it without changing normal page behavior. The prototype uses strict TypeScript, Safari-compatible caret APIs, geometric character validation, pure English word segmentation, and a deterministic Manifest V3 bundle. Its automated suite contains 17 passing segmentation tests, and the built extension has passed manual smoke testing on real desktop Safari pages.

The next product stages need more than a standalone word. A future translation backend must receive enough page context to resolve meaning, phrasal verbs such as `get off`, separated expressions such as `turn the light off`, and other context-dependent language. The future presentation layer also needs a stable viewport anchor and a serializable result that is independent of DOM objects.

Website text is not represented uniformly. A logical sentence or paragraph may span many inline elements, while raw `textContent` may include hidden, interactive, or structurally unrelated content. Pages also contain controls, editable areas, custom widgets, navigation, code, and malformed or unusually large text containers. The engine therefore needs explicit eligibility, normalization, boundary, size, and failure rules.

**Goal:** Produce a bounded, serializable `DetectionResult` containing the exact clicked English word, its containing sentence, its logical text block, the nearest surrounding text blocks, and a viewport anchor. The engine must remain mobile-compatible, preserve normal page behavior, and fail closed for unsupported or ambiguous hits.

---

## Implementation Approach

Detection runs as a local on-demand pipeline for each click or future tap. It examines only the hit and nearby reading context; it does not index the entire document, observe page mutations continuously, or cache a document-wide text model.

The browser entry point supplies viewport coordinates and event-path metadata without cancelling the event. Hit-testing resolves and geometrically validates one text character. Eligibility then rejects explicit interactive, editable, hidden, and unsupported targets. A local text snapshot combines eligible inline text in reading order, normalizes whitespace, and maps the clicked DOM offset into the normalized text. Word and sentence segmentation produce spans inside that text. Finally, the context collector adds at most one neighboring block on each side and applies bounded size limits.

Expected unsupported cases return no result. A missing neighboring block degrades to an empty side of the context envelope, while loss of the clicked word, its mapped offset, or its sentence invalidates the complete result.

### Data flow

```text
capture-phase click / future tap metadata
                    |
                    v
       Safari point-to-character adapter
                    |
                    v
        exact TextHit + viewport rect
                    |
                    v
         semantic eligibility policy
                    |
                    v
      focus block and reading container
                    |
                    v
  normalized text snapshot + offset mapping
                    |
                    v
       English word and sentence spans
                    |
                    v
 nearest previous and next eligible blocks
                    |
                    v
       serializable DetectionResult | null
```

### Detection result contract

The following TypeScript interface is the shared output contract. `TextSpan.start` is inclusive, `TextSpan.end` is exclusive, and both offsets refer to UTF-16 code units in the corresponding normalized `text` value.

```ts
interface TextSpan {
  readonly start: number;
  readonly end: number;
}

interface ContextBlock {
  readonly text: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
}

interface FocusContextBlock extends ContextBlock {
  readonly word: TextSpan;
  readonly sentence: TextSpan;
}

interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DetectionResult {
  readonly anchorRect: ViewportRect;
  readonly context: {
    readonly beforeBlocks: readonly ContextBlock[];
    readonly focusBlock: FocusContextBlock;
    readonly afterBlocks: readonly ContextBlock[];
  };
}
```

The clicked word is `focusBlock.text.slice(word.start, word.end)`. The containing sentence is derived through the equivalent `sentence` span. The contract avoids duplicated word or sentence strings that could disagree with their source block.

### Backend Scope

#### TapTranslate backend

No backend changes are included in this stage. The future backend will receive a serializable derivative of `DetectionResult.context`, interpret the clicked token within the supplied sentence and surrounding blocks, and return the resolved lexical expression, translation, explanation, and examples. Semantic resolution of phrasal verbs, idioms, collocations, and separated expressions belongs to that later backend stage.

### Frontend Scope

#### Interaction adapter

The interaction adapter remains a side-effect-only boundary. It supplies viewport coordinates, the original event target, and the composed event path. It does not depend on hover, right-click, fixed mouse precision, or another desktop-only input assumption, and it never calls `preventDefault()` or `stopPropagation()`.

#### Safari hit-testing

Hit-testing continues to prefer `caretPositionFromPoint()` and fall back to `caretRangeFromPoint()`. The resulting caret insertion position is geometrically validated against adjacent character rectangles. A valid internal hit contains one text node, one exact UTF-16 character offset, and one positive-size viewport rectangle.

#### Target eligibility

Visible ordinary text is eligible even when it appears inside inline formatting or structural regions such as headers, asides, and footers. Inline wrappers such as spans, emphasis, and strong emphasis do not create boundaries.

The hit is rejected when the clicked text or its relevant ancestor path belongs to a native link or control, label, editable area, interactive WAI-ARIA widget, non-negative `tabindex`, or explicit click handler. Script, style, template, canvas, SVG text, form-control content, code, and preformatted code regions are unsupported. Hidden and `aria-hidden` content is ineligible.

`cursor: pointer` alone is not an interactive signal. This keeps glossary terms and other intentionally highlighted reading text eligible. Custom widgets that expose none of the supported semantic signals may remain eligible; the extension still does not cancel or alter their page event.

#### Focus block and reading container

The focus block is the nearest logical text block containing the hit. Semantic paragraph, list item, quotation, caption, description-list item, heading, and table-cell elements take precedence. A rendered block container is the fallback for pages built from generic elements.

The reading container is the nearest structural region that keeps neighboring content local to the same flow. Neighbor lookup does not cross an enclosing article, main, or section boundary. When no such region exists, lookup remains within the focus block's parent flow rather than searching the full body.

Structural tags do not by themselves make the clicked focus text ineligible. They constrain neighbor lookup so context from an article is not mixed with navigation, sidebars, or unrelated page regions.

#### Text snapshot and normalization

The snapshot walks eligible visible text nodes in DOM reading order and preserves a mapping from the source hit into normalized focus-block text. It retains letter case, punctuation, and straight or typographic apostrophes. Ordinary whitespace sequences collapse to a single space; explicit line breaks remain newline boundaries. Inline boundaries neither concatenate separate words nor invent spaces inside a word split only for styling.

All public spans refer to the normalized text. If the DOM changes during extraction and the hit can no longer be mapped consistently, the pipeline returns no result.

#### Word, sentence, and surrounding context

The existing English word rules remain unchanged: ASCII letters with optional internal straight or typographic apostrophes are accepted, while whitespace, punctuation, numbers, alphanumeric tokens, non-Latin text, and a direct click on an apostrophe are rejected.

English sentence segmentation selects the sentence containing the accepted word span. A focus block without terminal punctuation is still one sentence. The engine does not perform grammatical or semantic interpretation.

The context envelope contains no more than one previous and one next eligible text block from the same reading container. Blocks stay separate so later consumers can preserve discourse boundaries.

Default internal limits are 4,000 UTF-16 code units for the focus block, 2,000 for each neighboring block, and 8,000 for the full context envelope. Truncation retains the clicked word and preserves its complete sentence whenever that sentence fits within the focus-block limit. Truncation direction is reported explicitly. These limits are policy values and can be tuned later without changing the output contract.

#### Detection orchestration

The orchestrator exposes one detection operation and returns either a complete `DetectionResult` or no result. Intermediate DOM nodes, ranges, computed styles, and event targets never escape through the public result. Missing neighboring context is recoverable; missing focus identity, offset mapping, sentence containment, or anchor geometry is not.

---

## Non-Functional Requirements

- Safari 15.4 and iOS 15.4 remain the minimum browser targets.
- Detection uses no Node.js runtime API, network call, storage, background script, persistent observer, or document-wide index.
- Normal page clicks, links, controls, selection, and scrolling retain their browser behavior.
- Context extraction is bounded to three output blocks and at most 8,000 UTF-16 code units.
- The clicked word span is always non-empty and within the focus text.
- The sentence span always contains the complete clicked word span and remains within the focus text.
- The anchor rectangle always has positive width and height and uses viewport CSS pixels.
- Expected unsupported or ambiguous input returns no result and produces no error log.
- Unexpected failures are contained at the browser entry boundary and never include extracted page text in logs.
- The output contract contains only serializable values and no DOM references.
- No extracted context is persisted, transmitted, or logged during this stage; the existing success log remains limited to the clicked word for manual acceptance.

---

## Testing Strategy

### Automated tests

- Word tests retain the existing beginning, middle, boundary, contraction, punctuation, numeric, alphanumeric, non-Latin, empty, and invalid-offset cases.
- Sentence tests cover beginning and end boundaries, multiple sentences, punctuation, abbreviations represented in the fixture corpus, line breaks, missing terminal punctuation, and containment of the word span.
- Normalization tests cover nested inline elements, styled word fragments, explicit and collapsed whitespace, line breaks, punctuation adjacency, source-to-normalized offset mapping, truncation, and word preservation.
- Eligibility tests cover native links and controls, labels, editable content, interactive ARIA roles, `tabindex`, explicit click handlers, hidden content, unsupported elements, and an eligible `cursor: pointer` glossary term.
- Focus-block tests cover paragraphs, headings, lists, quotations, captions, description lists, tables, generic block fallbacks, and structural reading-container boundaries.
- Neighbor tests verify at most one block on each side, correct reading order, skipped ineligible blocks, no cross-section leakage, independent truncation flags, and graceful absence of either side.
- Hit-testing tests cover the standard and WebKit caret APIs, invalid caret offsets, zero-size rectangles, adjacent-character ambiguity, punctuation, whitespace, and DOM mutation during processing.
- Pipeline tests cover a complete eligible result and fail-closed outcomes at every mandatory stage.

DOM fixture tests may use a development-only DOM implementation for structure and visibility metadata. Geometry remains explicitly stubbed because a Node test environment cannot reproduce Safari layout.

### Manual desktop Safari acceptance

1. Build and load the temporary extension in desktop Safari.
2. Verify a plain paragraph, nested inline formatting, a heading, a list item, a quotation, and a table cell.
3. Verify clicks on the first, middle, and last letter of words and contractions.
4. Verify no result for whitespace, punctuation, numbers, alphanumeric tokens, non-Latin text, apostrophes, links, controls, editable text, and code.
5. Verify a glossary-like term with only `cursor: pointer` remains eligible.
6. Verify normal links, controls, selection, and page click handlers continue to work.
7. Exercise the local integration fixture plus representative real article, documentation, search, and dynamically rendered pages.
8. Confirm the console contains one successful word log per eligible click, no extracted context, and no unexpected errors.

### Data validation

For each integration fixture, expected normalized focus text, word span, sentence span, neighboring blocks, truncation flags, and viewport anchor are asserted together. This prevents individually passing helpers from producing an inconsistent final contract.

---

## Rollout / Migration Plan

The project is pre-release and has no production users or persisted extension data, so this stage requires no data migration or runtime feature flag.

1. Land eligibility, snapshot, context, and orchestration changes in testable increments while preserving the current word-only success log.
2. Run the complete npm verification suite after each increment and inspect the deterministic build output.
3. Complete the local fixture acceptance matrix in a temporary desktop Safari extension.
4. Repeat smoke tests on representative real websites before merging the feature branch.
5. Keep the accepted prototype commit available as the rollback point; a regression can be reverted without data repair or backend coordination.

| Risk                                                  | Mitigation                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Incorrect block boundaries mix unrelated page regions | Constrain neighbor lookup to the nearest reading container and assert no cross-section leakage in fixtures.                   |
| Whitespace normalization shifts the clicked offset    | Maintain explicit source-to-normalized mapping and assert complete result invariants.                                         |
| A large generic container causes expensive traversal  | Enforce bounded collection and output limits without a document-wide scan.                                                    |
| A custom widget lacks semantic interaction markers    | Preserve page behavior and refine semantic signals later from real examples rather than treating visual styling as proof.     |
| Sentence segmentation is imperfect for unusual prose  | Preserve the complete focus block and surrounding blocks so the future backend is not limited to the frontend sentence guess. |
| Safari caret geometry differs from test doubles       | Retain manual Safari acceptance for real layout behavior.                                                                     |

---

## Third Party Dependencies

- Safari DOM caret and Range APIs provide point-to-character and geometry data.
- `Intl.Segmenter` provides English word and sentence boundaries within the supported Safari baseline.
- The existing pinned TypeScript, Vite, Vitest, ESLint, and Prettier toolchain remains in use.
- A development-only DOM fixture implementation may be selected in the implementation plan; no production runtime dependency is introduced.

No backend, AI provider, native application, analytics service, or remote API participates in this stage.

---

## Rejected Approaches

### Extend the current hit-testing function into one large operation

This minimizes the first diff but couples geometry, interaction policy, DOM traversal, normalization, and context semantics. It makes independent testing and later mobile changes unnecessarily risky.

### Use the nearest element's raw `textContent`

Raw `textContent` loses rendered whitespace intent and may include hidden, interactive, code, or structurally unrelated text. It also does not preserve a reliable mapping for the clicked offset across nested elements.

### Pre-index and cache the complete document

A document-wide model speeds repeated clicks but introduces mutation observation, cache invalidation, memory cost, and dynamic-page correctness problems before performance evidence justifies them.

### Build Reader Mode-style article extraction

Whole-article inference could provide broad context but greatly expands scope and creates new heuristics for page classification. Local block context is sufficient for the first backend contract.

### Resolve phrasal verbs in the extension

Phrasal verbs, idioms, and separated expressions require semantic interpretation. Handwritten frontend heuristics would duplicate future backend intelligence and fail on constructions such as `turn the light off`.

### Reject every `cursor: pointer` target

Visual cursor styling is not a reliable interaction contract and is commonly used for glossary terms or highlighted reading text. Semantic interaction signals provide a better balance.

---

## Out of Scope

- Translation UI, bottom sheet behavior, loading states, examples, and explanation rendering
- Mock translation provider and translation request/response contracts
- Backend, AI-provider, authentication, networking, rate limiting, and persistence
- Background scripts, extension storage, settings, and native messaging
- Xcode containers, iOS deployment, mobile gesture policy, and TestFlight
- Semantic resolution of phrasal verbs, idioms, collocations, and word senses
- Full Reader Mode extraction or whole-document indexing
- Complete support for inaccessible shadow roots, cross-origin frames, canvas, SVG text, and code blocks
- Automated Safari WebDriver or iOS browser testing
