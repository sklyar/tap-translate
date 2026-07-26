# Detection & Context Engine Design

Related: [product roadmap](2026-07-26-taptranslate-product-roadmap-design.md) and [desktop prototype design](2026-07-26-desktop-safari-prototype-design.md).

## Goal

Extend the working desktop Safari prototype from returning one English word to returning a bounded, serializable context for that word. The result must contain the exact clicked word, its sentence, its logical text block, nearby blocks, and a viewport anchor for the future UI.

The engine is developed and tested primarily in desktop Safari but must not depend on desktop-only input behavior. It preserves normal page events and returns `null` for unsupported or ambiguous hits.

## Scope

This stage includes:

- semantic eligibility rules for clicked page text;
- exact point-to-character hit-testing and viewport geometry;
- text extraction across nested inline DOM nodes;
- whitespace normalization with source-offset mapping;
- English word and sentence spans;
- the current logical block plus at most one neighboring block on each side;
- automated tests, a local DOM fixture, and desktop Safari acceptance.

This stage does not include translation UI, mock responses, backend calls, semantic interpretation, storage, background scripts, Xcode packaging, or mobile gesture handling.

## Result contract

`TextSpan.start` is inclusive and `TextSpan.end` is exclusive. Both are UTF-16 offsets in the corresponding normalized `text`.

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

The clicked word is derived with `focusBlock.text.slice(word.start, word.end)`. The sentence is derived through the equivalent `sentence` span. The contract contains no DOM objects and can later be passed to a mock or backend adapter. `anchorRect` is the exact clicked-character rectangle; word-level geometry can be added with the future UI if it becomes necessary.

## Processing flow

Detection is local and on demand. It does not pre-index the page, cache a document model, or observe mutations continuously.

```text
click / future tap metadata
          |
          v
exact text character and viewport rectangle
          |
          v
semantic target eligibility
          |
          v
focus block and reading container
          |
          v
normalized text with mapped clicked offset
          |
          v
word and sentence spans
          |
          v
previous and next context blocks
          |
          v
DetectionResult | null
```

The implementation remains a small pipeline with these responsibilities:

- the interaction adapter supplies coordinates, the event target, and the composed event path without cancelling the event;
- hit-testing resolves one geometrically validated character using the standard caret API first and the Safari fallback second;
- eligibility decides whether the clicked DOM path is ordinary readable text;
- the snapshot builder converts the local DOM text into normalized text while preserving the clicked offset;
- context extraction finds the sentence, focus block, and neighboring blocks;
- one orchestrator returns the complete result or `null`.

No classes, dependency-injection layer, document-wide cache, `MutationObserver`, or generic DOM framework are introduced.

## Eligibility rules

Visible ordinary text is eligible inside inline formatting and structural regions such as headings, headers, asides, and footers. Eligibility is cross-checked against both the resolved text-node ancestry and the original event target and composed path so an overlay cannot expose unrelated text underneath it.

A hit is rejected when its relevant ancestor path contains:

- a native link with a destination, button, form control, label, summary, or media element with controls;
- editable content;
- an interactive WAI-ARIA role;
- a non-negative `tabindex`;
- an explicit click handler;
- hidden or `aria-hidden` content;
- script, style, template, canvas, SVG text, code, or preformatted code content.

Native interaction, interactive roles, editability, and visibility are checked through the relevant ancestry up to the document body. `tabindex` and explicit `onclick` attribute or property checks stop at the focus block so a delegated page-level handler does not disable an entire page. Event listeners registered only through `addEventListener()` are not introspectable and are not treated as signals.

`cursor: pointer` alone does not make text ineligible. This preserves glossary terms and highlighted reading text. A custom widget without semantic interaction signals may remain eligible, but TapTranslate still does not alter its normal click behavior.

Click eligibility and context inclusion are separate policies. Clicking linked or widget text is rejected, but its visible inline text remains part of a surrounding prose snapshot when another word in that block is clicked. Hidden, editable, form-control, code, preformatted, script, style, template, canvas, and SVG subtrees remain excluded from snapshots.

## Text blocks and context

The focus block is the nearest matching ancestor of the clicked word. The semantic set is `p`, `li`, `blockquote`, `figcaption`, `dt`, `dd`, `h1`–`h6`, `caption`, `td`, and `th`; the nearest match wins. If none exists, the nearest ancestor whose computed display is `block`, `flow-root`, `list-item`, `table-cell`, `table-caption`, `flex`, or `grid` is used. `html` and `body` are never focus blocks.

The reading region is the nearest `article`, `main`, `section`, `aside`, `nav`, `header`, or `footer`. Neighbors must belong to that same nearest region. If no region exists, lookup remains in the focus block's parent flow; when that parent is `html` or `body`, no neighbors are collected.

Neighbors are the nearest distinct logical blocks before and after the focus block in DOM reading order. Nested logical blocks are not flattened into their ancestor snapshot, and blocks owned by a nested or different reading region are skipped. Structural tags do not prevent translating their own ordinary text; they constrain surrounding-context lookup.

The result contains no more than one previous and one next eligible block. Blocks remain separate so the future backend can preserve discourse boundaries.

Semantic interpretation is outside this engine. For example, clicking `turn` in `Turn the light off` identifies `turn` and supplies the complete sentence and nearby text. The future backend determines that the relevant expression is `turn off`.

## Normalization and limits

- Preserve letter case, punctuation, and straight or typographic apostrophes.
- Collapse whitespace originating in text nodes to one space and trim normalized leading and trailing whitespace.
- Emit one newline for each explicit `<br>`; `<br>` does not by itself force a sentence boundary, and the English segmenter decides how the newline participates.
- Concatenate inline text in DOM order and never invent a separator between inline nodes. Existing whitespace remains a separator, while a word split only for styling remains one word.
- Express word and sentence spans relative to the normalized focus text.
- Use `Intl.Segmenter('en', { granularity: 'sentence' })`, trim whitespace from the selected sentence span, and treat a block without terminal punctuation as one sentence.

Default internal limits are:

- 4,000 UTF-16 code units for the focus block;
- 2,000 for the previous block;
- 2,000 for the next block;
- 8,000 for the complete envelope.

If the containing sentence alone exceeds 4,000 code units, detection returns `null`. Otherwise focus truncation keeps the complete sentence, rebases both spans, and uses the remaining budget around it. The previous block keeps the suffix nearest the focus, while the next block keeps the nearest prefix. Cuts never leave an unpaired UTF-16 surrogate. `truncatedBefore` and `truncatedAfter` report removed text, and the 8,000 limit is the sum of the three block-text lengths. These limits are internal policy values and can be tuned later without changing the result contract.

## Failure behavior

Expected unsupported cases return `null` without logging an error. This includes an invalid point, unsupported caret APIs, ambiguous character geometry, an ineligible target, a failed source-offset mapping, and no accepted English word or containing sentence.

Missing neighboring context is recoverable: the corresponding array is empty. Missing focus identity, word span, sentence span, or positive-size anchor geometry invalidates the result.

DOM changes and expected `Range` failures during extraction also return `null`. The browser entry boundary contains unexpected exceptions so TapTranslate never breaks the page, and error logs never include extracted page text. During this stage the existing successful console log remains limited to the clicked word.

## Correctness constraints

- The handler never calls `preventDefault()` or `stopPropagation()`.
- The word span is non-empty and inside the focus text.
- The sentence span contains the full word span and is inside the focus text.
- The anchor rectangle has positive width and height and uses viewport CSS pixels.
- The output contains at most three blocks and 8,000 UTF-16 code units.
- The output is serializable and contains no DOM references.
- No extracted context is persisted, transmitted, or logged.
- Safari 15.4 and iOS 15.4 remain the minimum targets.

## Testing

Automated coverage includes:

- existing English word boundaries and contractions;
- sentence boundaries, punctuation, line breaks, missing terminal punctuation, and word containment;
- nested inline markup, styled word fragments, whitespace normalization, source-offset mapping, and truncation;
- native and ARIA interaction signals, editable and hidden content, explicit click handlers, and an eligible `cursor: pointer` term;
- paragraphs, headings, lists, quotations, captions, tables, generic block fallbacks, and reading-container boundaries;
- previous and next block selection, skipped ineligible blocks, and no cross-section leakage;
- standard and WebKit caret APIs, invalid offsets, zero-size geometry, adjacent-character ambiguity, and DOM mutation;
- complete pipeline results and fail-closed outcomes at every mandatory stage.

DOM fixtures test structure and visibility metadata. Geometry is stubbed because a Node test environment cannot reproduce Safari layout.

Manual desktop Safari acceptance verifies the local fixture and representative article, documentation, search, and dynamic pages. It covers plain and nested text, headings, lists, quotations, tables, contractions, rejected targets, `cursor: pointer` glossary text, preserved page behavior, one successful word log, and no unexpected errors.

Automated Safari WebDriver and iOS testing remain outside this stage.
