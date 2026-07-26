# Detection & Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Safari word-hit prototype into a mobile-compatible, fail-closed pipeline that returns the clicked English word, containing sentence, local text block, adjacent context blocks, and exact character anchor.

**Architecture:** A thin interaction entry point passes device-neutral click metadata into a local on-demand pipeline. Safari hit-testing, semantic eligibility, DOM text normalization, linguistic segmentation, and context collection remain separate focused modules; the public result contains only serializable strings, spans, flags, and viewport geometry.

**Tech Stack:** TypeScript 6.0.3, Vite 8.1.5, Vitest 4.1.10, jsdom 28.1.0 for DOM-only tests, ESLint 10 flat config, Prettier 3.9.6, npm 11, Safari Web Extension Manifest V3.

## Global Constraints

- Safari 15.4 and iOS 15.4 are the minimum browser targets.
- Node.js 22.13 or newer and npm 11 remain the development baseline.
- Add `jsdom@28.1.0` as an exact development dependency; add no production dependency.
- Keep native ESM, strict TypeScript, `noEmit`, exact dependency versions, and the committed npm lockfile.
- The browser handler must not call `preventDefault()` or `stopPropagation()`.
- Detection is local and on demand: no backend, UI, storage, background script, document-wide cache, or `MutationObserver`.
- Expected unsupported or ambiguous input returns `null` without logging page text.
- Context output contains at most one previous block, one focus block, one next block, and 8,000 UTF-16 code units total.
- `anchorRect` is the exact clicked-character rectangle in viewport CSS pixels.
- Keep `extension/dist` limited to `content.js`, `content.js.map`, and `manifest.json`.

## File Structure

- `extension/src/content.ts` — passive capture-phase browser entry point and successful word logging.
- `extension/src/detection.ts` — public input/result contract and pipeline orchestration.
- `extension/src/hit-testing.ts` — Safari point-to-character adapter and plain viewport geometry.
- `extension/src/target-eligibility.ts` — target rejection and context-visibility policies.
- `extension/src/text-snapshot.ts` — logical block resolution, DOM-order normalization, and source-offset mapping.
- `extension/src/context-extraction.ts` — sentence selection, truncation, neighboring blocks, and final context envelope.
- `extension/src/word-segmentation.ts` — pure accepted-English word and span lookup.
- `extension/src/sentence-segmentation.ts` — pure English sentence-span lookup.
- `extension/tests/dom-test-helpers.ts` — deterministic caret and Range geometry stubs shared by DOM tests.
- `extension/tests/*.test.ts` — focused pure, DOM, geometry, and pipeline tests.
- `extension/tests/fixtures/index.html` — manual desktop Safari acceptance page, never copied into `dist`.

---

### Task 1: English Word and Sentence Spans

**Files:**

- Modify: `extension/src/word-segmentation.ts`
- Modify: `extension/tests/word-segmentation.test.ts`
- Create: `extension/src/sentence-segmentation.ts`
- Create: `extension/tests/sentence-segmentation.test.ts`

**Interfaces:**

- Produces: `TextSpan { readonly start: number; readonly end: number }`.
- Produces: `getEnglishWordSpanAtOffset(text: string, offset: number): TextSpan | null`.
- Preserves: `getEnglishWordAtOffset(text: string, offset: number): string | null` as a wrapper.
- Produces: `getEnglishSentenceSpanAtOffset(text: string, offset: number): TextSpan | null`.

- [ ] **Step 1: Add failing word-span tests**

Extend `tests/word-segmentation.test.ts` with exact span assertions:

```ts
import {
  getEnglishWordAtOffset,
  getEnglishWordSpanAtOffset,
} from "../src/word-segmentation";

it.each([
  { text: "Hello world", offset: 0, expected: { start: 0, end: 5 } },
  { text: "Hello world", offset: 8, expected: { start: 6, end: 11 } },
  { text: "I can't wait", offset: 2, expected: { start: 2, end: 7 } },
  { text: "I can’t wait", offset: 6, expected: { start: 2, end: 7 } },
])(
  "returns the English word span at $offset in $text",
  ({ text, offset, expected }) => {
    expect(getEnglishWordSpanAtOffset(text, offset)).toEqual(expected);
  },
);

it.each([
  { text: "", offset: 0 },
  { text: "Hello", offset: -1 },
  { text: "Hello", offset: 5 },
  { text: "Hello world", offset: 5 },
  { text: "can't", offset: 3 },
  { text: "abc123", offset: 1 },
  { text: "Привет", offset: 0 },
])("returns no English word span at $offset in $text", ({ text, offset }) => {
  expect(getEnglishWordSpanAtOffset(text, offset)).toBeNull();
});
```

- [ ] **Step 2: Run the word tests and confirm the new export is missing**

Run from `extension/`:

```bash
rtk npm test -- --run tests/word-segmentation.test.ts
```

Expected: FAIL because `getEnglishWordSpanAtOffset` is not exported.

- [ ] **Step 3: Implement word spans and keep the string API as a wrapper**

Replace `word-segmentation.ts` with:

```ts
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

const englishWordSegmenter = new Intl.Segmenter("en", {
  granularity: "word",
});

const englishLetterPattern = /^[A-Za-z]$/;
const englishWordPattern = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

export function getEnglishWordSpanAtOffset(
  text: string,
  offset: number,
): TextSpan | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    return null;
  }

  const character = text[offset];
  if (character === undefined || !englishLetterPattern.test(character)) {
    return null;
  }

  const segment = englishWordSegmenter.segment(text).containing(offset);
  if (
    segment?.isWordLike !== true ||
    !englishWordPattern.test(segment.segment)
  ) {
    return null;
  }

  return {
    start: segment.index,
    end: segment.index + segment.segment.length,
  };
}

export function getEnglishWordAtOffset(
  text: string,
  offset: number,
): string | null {
  const span = getEnglishWordSpanAtOffset(text, offset);
  return span === null ? null : text.slice(span.start, span.end);
}
```

- [ ] **Step 4: Add failing sentence-span tests**

Create `tests/sentence-segmentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getEnglishSentenceSpanAtOffset } from "../src/sentence-segmentation";

describe("getEnglishSentenceSpanAtOffset", () => {
  it.each([
    {
      name: "first sentence",
      text: "First sentence. Second sentence!",
      offset: 2,
      expected: { start: 0, end: 15 },
    },
    {
      name: "second sentence without leading whitespace",
      text: "First sentence. Second sentence!",
      offset: 17,
      expected: { start: 16, end: 32 },
    },
    {
      name: "sentence after an explicit newline",
      text: "One.\nTwo.",
      offset: 6,
      expected: { start: 5, end: 9 },
    },
    {
      name: "block without terminal punctuation",
      text: "Turn the light off",
      offset: 5,
      expected: { start: 0, end: 18 },
    },
  ])("returns the $name", ({ text, offset, expected }) => {
    expect(getEnglishSentenceSpanAtOffset(text, offset)).toEqual(expected);
  });

  it.each([
    { text: "", offset: 0 },
    { text: "Sentence.", offset: -1 },
    { text: "Sentence.", offset: 9 },
    { text: "   ", offset: 1 },
  ])("returns null for invalid or whitespace input", ({ text, offset }) => {
    expect(getEnglishSentenceSpanAtOffset(text, offset)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the sentence tests and confirm the module is missing**

```bash
rtk npm test -- --run tests/sentence-segmentation.test.ts
```

Expected: FAIL because `src/sentence-segmentation.ts` does not exist.

- [ ] **Step 6: Implement trimmed English sentence spans**

Create `sentence-segmentation.ts` with one module-level `Intl.Segmenter('en', { granularity: 'sentence' })`. Validate the offset, call `.segment(text).containing(offset)`, derive the segment start/end, trim only leading and trailing whitespace from those offsets, and return `null` when the trimmed span is empty or does not contain the requested offset.

The implementation must return `TextSpan` imported with `import type` from `word-segmentation.ts`; it does not create a second span type.

- [ ] **Step 7: Run focused and static checks**

```bash
rtk npm test -- --run tests/word-segmentation.test.ts tests/sentence-segmentation.test.ts
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 8: Commit the pure segmentation foundation**

```bash
rtk git add extension/src/word-segmentation.ts extension/src/sentence-segmentation.ts extension/tests/word-segmentation.test.ts extension/tests/sentence-segmentation.test.ts
rtk git commit -m "feat(extension): add word and sentence spans"
```

---

### Task 2: DOM Test Harness and Exact Character Hits

**Files:**

- Modify: `extension/package.json`
- Modify: `extension/package-lock.json`
- Modify: `extension/src/hit-testing.ts`
- Modify: `extension/src/content.ts`
- Create: `extension/tests/dom-test-helpers.ts`
- Create: `extension/tests/hit-testing.test.ts`

**Interfaces:**

- Produces: `ViewportRect { readonly x; readonly y; readonly width; readonly height }`.
- Produces: `TextHit { readonly textNode: Text; readonly characterOffset: number; readonly anchorRect: ViewportRect }`.
- Produces: `findTextHitAtPoint(point: ViewportPoint, documentRoot?: Document): TextHit | null`.

- [ ] **Step 1: Install the one development-only DOM dependency**

```bash
rtk npm install --save-dev --save-exact jsdom@28.1.0
rtk npm ls jsdom --depth=0
```

Expected: `jsdom@28.1.0`; no production dependency is added. Do not add `happy-dom`, Testing Library, canvas, or `@types/jsdom`.

- [ ] **Step 2: Add deterministic Range geometry helpers**

Create `tests/dom-test-helpers.ts` exporting a plain `TEST_RECT`, `setCaretPositionFromPoint()`, `setCaretRangeFromPoint()`, and `stubCharacterRectangles()`. The two caret helpers define the non-standard document methods with `Object.defineProperty(..., { configurable: true, value })`. The Range helper replaces `document.createRange()` with a minimal test double whose `getClientRects()` result is selected by the last `setStart()` offset.

The helper must use `vi.spyOn`, return arrays as `DOMRectList` test doubles, and expose no application code dependency.

- [ ] **Step 3: Write failing hit-testing tests**

Create `tests/hit-testing.test.ts` with `// @vitest-environment jsdom` on the first line. Cover these exact cases:

```ts
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  Reflect.deleteProperty(document, "caretRangeFromPoint");
  document.body.replaceChildren();
});

it("prefers caretPositionFromPoint and returns the matched character rectangle", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));

  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toEqual({
    textNode,
    characterOffset: 1,
    anchorRect: { x: 10, y: 10, width: 10, height: 10 },
  });
});

it("uses caretRangeFromPoint only when the standard API is unavailable", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretRangeFromPoint(document, textNode, 2);
  stubCharacterRectangles(document, new Map([[2, [TEST_RECT]]]));

  expect(
    findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)?.characterOffset,
  ).toBe(2);
});

it("returns null when adjacent characters both contain the point", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(
    document,
    new Map([
      [0, [TEST_RECT]],
      [1, [TEST_RECT]],
    ]),
  );

  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});

it("returns null for a non-text caret node", () => {
  setCaretPositionFromPoint(document, { offsetNode: document.body, offset: 0 });
  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});

it("returns null for an invalid caret offset", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 6 });
  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});

it("returns null for zero-size geometry", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(
    document,
    new Map([[1, [{ ...TEST_RECT, width: 0 }]]]),
  );
  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});

it("returns null for a non-finite point", () => {
  expect(
    findTextHitAtPoint({ clientX: Number.NaN, clientY: 15 }, document),
  ).toBeNull();
});

it("returns null when the caret API throws", () => {
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => {
      throw new DOMException("mutated");
    },
  });
  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});

it("returns null when Range creation throws", () => {
  const textNode = document.createTextNode("Hello");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  vi.spyOn(document, "createRange").mockImplementation(() => {
    throw new DOMException("mutated");
  });
  expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toBeNull();
});
```

- [ ] **Step 4: Run the hit tests and confirm the new API is missing**

```bash
rtk npm test -- --run tests/hit-testing.test.ts
```

Expected: FAIL because `findTextHitAtPoint`, `TextHit`, and `ViewportRect` do not exist.

- [ ] **Step 5: Refactor hit-testing to return the unique character hit**

Remove word segmentation from `hit-testing.ts`. Refactor character geometry from a boolean into a plain rectangle result. A rectangle is eligible only when all coordinates and dimensions are finite, width and height are positive, and the point lies inside it.

For the candidate offsets `[caretOffset, caretOffset - 1]`, return a result only when exactly one character produces exactly one matching rectangle. Wrap caret and Range operations in a fail-closed `try/catch`. Preserve standard-API precedence; a present standard API returning `null` does not invoke the WebKit fallback.

- [ ] **Step 6: Keep the entry point working during the refactor**

Update `content.ts` temporarily to call `findTextHitAtPoint()` and pass `hit.textNode.data` plus `hit.characterOffset` to `getEnglishWordAtOffset()`. Preserve the exact existing log and passive capture listener.

- [ ] **Step 7: Run focused and complete checks**

```bash
rtk npm test -- --run tests/hit-testing.test.ts tests/word-segmentation.test.ts
rtk npm run check
```

Expected: all tests and the production build pass; `dist` remains three files.

- [ ] **Step 8: Commit exact hit geometry**

```bash
rtk git add extension/package.json extension/package-lock.json extension/src/hit-testing.ts extension/src/content.ts extension/tests/dom-test-helpers.ts extension/tests/hit-testing.test.ts
rtk git commit -m "feat(extension): expose validated text hits"
```

---

### Task 3: Semantic Target Eligibility

**Files:**

- Create: `extension/src/target-eligibility.ts`
- Create: `extension/tests/target-eligibility.test.ts`

**Interfaces:**

- Produces: `InteractionMetadata { readonly target: EventTarget | null; readonly eventPath: readonly EventTarget[] }`.
- Produces: `isEligibleTextTarget(textNode: Text, focusBlock: Element, interaction: InteractionMetadata): boolean`.
- Produces: `isVisibleContextText(textNode: Text): boolean` for snapshot inclusion, deliberately separate from click eligibility.

- [ ] **Step 1: Write failing target-policy tests**

Create `tests/target-eligibility.test.ts` with the jsdom environment annotation. Build table-driven fixtures that select one text node and its focus block:

```ts
const firstTextNode = (root: Element): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text;
};

const eventPathFrom = (target: Element): EventTarget[] => {
  const path: EventTarget[] = [];
  for (
    let current: Element | null = target;
    current !== null;
    current = current.parentElement
  ) {
    path.push(current);
  }
  return [...path, document, window];
};

it.each([
  ["link with href", '<p><a href="/next">linked word</a></p>', "a"],
  ["button", "<p><button>button word</button></p>", "button"],
  ["label", "<p><label>label word</label></p>", "label"],
  ["summary", "<details><summary>summary word</summary></details>", "summary"],
  ["editable text", '<p contenteditable="true">editable word</p>', "p"],
  ["ARIA button", '<p><span role="button">ARIA word</span></p>', "span"],
  [
    "focusable widget",
    '<p><span tabindex="0">focusable word</span></p>',
    "span",
  ],
  [
    "inline handler",
    '<p><span onclick="void 0">handled word</span></p>',
    "span",
  ],
  ["hidden ancestor", "<p hidden>hidden word</p>", "p"],
  ["ARIA-hidden ancestor", '<p aria-hidden="true">hidden word</p>', "p"],
  ["display none", '<p style="display: none">hidden word</p>', "p"],
  ["code", "<p><code>return word</code></p>", "code"],
])("rejects %s", (_name, html, selector) => {
  document.body.innerHTML = html;
  const target = document.querySelector(selector)!;
  const textNode = firstTextNode(target);
  const focusBlock = target.closest("p, li, blockquote, h1, h2, h3") ?? target;
  expect(
    isEligibleTextTarget(textNode, focusBlock, {
      target,
      eventPath: eventPathFrom(target),
    }),
  ).toBe(false);
});

it.each([
  ["plain formatted text", "<p><strong>plain word</strong></p>", "strong"],
  ["anchor without href", "<p><a>anchor word</a></p>", "a"],
  [
    "pointer styling only",
    '<p><span style="cursor: pointer">glossary word</span></p>',
    "span",
  ],
])("accepts %s", (_name, html, selector) => {
  document.body.innerHTML = html;
  const target = document.querySelector(selector)!;
  const focusBlock = target.closest("p")!;
  expect(
    isEligibleTextTarget(firstTextNode(target), focusBlock, {
      target,
      eventPath: eventPathFrom(target),
    }),
  ).toBe(true);
});

it("ignores a delegated body onclick outside the focus block", () => {
  document.body.setAttribute("onclick", "void 0");
  document.body.innerHTML += '<p id="focus"><span>plain word</span></p>';
  const target = document.querySelector("#focus span")!;
  expect(
    isEligibleTextTarget(
      firstTextNode(target),
      document.querySelector("#focus")!,
      {
        target,
        eventPath: eventPathFrom(target),
      },
    ),
  ).toBe(true);
});

it("keeps visible link text for context but rejects it as the click target", () => {
  document.body.innerHTML =
    '<p id="focus">Read <a href="/term">this term</a> now.</p>';
  const target = document.querySelector("a")!;
  const textNode = firstTextNode(target);
  expect(isVisibleContextText(textNode)).toBe(true);
  expect(
    isEligibleTextTarget(textNode, document.querySelector("#focus")!, {
      target,
      eventPath: eventPathFrom(target),
    }),
  ).toBe(false);
});

it("rejects an overlay button from the event path", () => {
  document.body.innerHTML =
    '<p id="focus">plain word</p><button id="overlay">Overlay</button>';
  const focusBlock = document.querySelector("#focus")!;
  const overlay = document.querySelector("#overlay")!;
  expect(
    isEligibleTextTarget(firstTextNode(focusBlock), focusBlock, {
      target: overlay,
      eventPath: eventPathFrom(overlay),
    }),
  ).toBe(false);
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

```bash
rtk npm test -- --run tests/target-eligibility.test.ts
```

Expected: FAIL because `target-eligibility.ts` does not exist.

- [ ] **Step 3: Implement the exact semantic policy**

Use these rules:

- Hard-reject `a[href]`, `area[href]`, `button`, `input`, `select`, `textarea`, `option`, `label`, `summary`, `audio[controls]`, and `video[controls]` anywhere in the relevant target ancestry below `body`.
- Hard-reject inherited editable content and roles `button`, `checkbox`, `combobox`, `gridcell`, `link`, `listbox`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `radio`, `scrollbar`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `textbox`, and `treeitem`.
- Hard-reject `hidden`, `aria-hidden="true"`, `display: none`, `visibility: hidden|collapse`, and `content-visibility: hidden` through the ancestry.
- Reject `tabIndex >= 0` and `onclick` attribute/property only between the event target and focus block inclusive; do not let a delegated body handler reject the page.
- Reject `script`, `style`, `template`, `canvas`, `svg`, `code`, and `pre` as target or context subtrees.
- Do not inspect `cursor`, `opacity`, listener registrations, viewport intersection, or pointer-event styling.
- `isVisibleContextText()` keeps visible inline link and widget labels for sentence coherence but excludes hidden, editable, form-control, code, preformatted, script, style, template, canvas, and SVG subtrees.

- [ ] **Step 4: Run focused and static checks**

```bash
rtk npm test -- --run tests/target-eligibility.test.ts
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 5: Commit the eligibility policy**

```bash
rtk git add extension/src/target-eligibility.ts extension/tests/target-eligibility.test.ts
rtk git commit -m "feat(extension): filter interactive text hits"
```

---

### Task 4: Logical Blocks and Mapped Text Snapshots

**Files:**

- Create: `extension/src/text-snapshot.ts`
- Create: `extension/tests/text-snapshot.test.ts`

**Interfaces:**

- Produces: `SourcePosition { readonly textNode: Text; readonly offset: number }`.
- Produces: `TextSnapshot { readonly text: string; readonly sourceOffset: number | null }`.
- Produces: `findFocusBlock(textNode: Text): Element | null`.
- Produces: `findReadingRegion(element: Element): Element | null`.
- Produces: `buildTextSnapshot(root: Element, source: SourcePosition | null): TextSnapshot | null`.

- [ ] **Step 1: Write failing focus-block tests**

Create jsdom tests covering the exact semantic precedence:

```ts
it.each([
  ["paragraph inside list item", '<li><p id="focus">Target</p></li>', "P"],
  [
    "paragraph inside quotation",
    '<blockquote><p id="focus">Target</p></blockquote>',
    "P",
  ],
  [
    "direct list text",
    '<li id="focus">Target<ul><li>Nested</li></ul></li>',
    "LI",
  ],
  ["heading", '<h2 id="focus"><span>Target</span></h2>', "H2"],
  [
    "table cell",
    '<table><tbody><tr><td id="focus">Target</td></tr></tbody></table>',
    "TD",
  ],
  [
    "generic block fallback",
    '<div id="focus"><span>Target</span></div>',
    "DIV",
  ],
])("chooses the nearest logical block for %s", (_name, html, tagName) => {
  document.body.innerHTML = html;
  const textNode =
    document.querySelector("#focus")?.firstChild?.firstChild ??
    document.querySelector("#focus")?.firstChild;
  expect(findFocusBlock(textNode as Text)?.tagName).toBe(tagName);
});
```

Add these exact boundary assertions in the same file:

```ts
it("does not use body as a focus block", () => {
  document.body.textContent = "Target";
  expect(findFocusBlock(document.body.firstChild as Text)).toBeNull();
});

it.each(["aside", "nav", "header", "footer", "section", "article", "main"])(
  "uses the nearest %s as the reading region",
  (tagName) => {
    document.body.innerHTML = `<${tagName} id="region"><div><p id="focus">Target</p></div></${tagName}>`;
    expect(findReadingRegion(document.querySelector("#focus")!)?.id).toBe(
      "region",
    );
  },
);
```

- [ ] **Step 2: Write failing normalization and offset-mapping tests**

```ts
it("normalizes nested inline text and maps the clicked source offset", () => {
  document.body.innerHTML =
    '<p id="focus">  Hello <strong>brave</strong> world.<br><em>Next</em></p>';
  const root = document.querySelector("#focus")!;
  const textNode = root.querySelector("strong")!.firstChild as Text;

  expect(buildTextSnapshot(root, { textNode, offset: 2 })).toEqual({
    text: "Hello brave world.\nNext",
    sourceOffset: 8,
  });
});

it("keeps a word split only by inline styling contiguous", () => {
  document.body.innerHTML =
    '<p id="focus"><span>t</span><strong>ur</strong><em>n</em></p>';
  const root = document.querySelector("#focus")!;
  const textNode = root.querySelector("strong")!.firstChild as Text;
  expect(buildTextSnapshot(root, { textNode, offset: 1 })).toEqual({
    text: "turn",
    sourceOffset: 2,
  });
});

it("keeps visible inline link text but prunes nested logical blocks", () => {
  document.body.innerHTML =
    '<li id="focus">Read <a href="/term">this</a> now<ul><li>Nested</li></ul></li>';
  expect(buildTextSnapshot(document.querySelector("#focus")!, null)?.text).toBe(
    "Read this now",
  );
});
```

Add these exact normalization failures and boundaries:

```ts
it("collapses source whitespace, preserves consecutive br elements, and trims edges", () => {
  document.body.innerHTML =
    '<p id="focus">  One \n <span>two</span><br><br>Three  </p>';
  expect(buildTextSnapshot(document.querySelector("#focus")!, null)).toEqual({
    text: "One two\n\nThree",
    sourceOffset: null,
  });
});

it("prunes hidden and unsupported descendants", () => {
  document.body.innerHTML =
    '<p id="focus">Visible <span hidden>Hidden</span><code>Code</code>end</p>';
  expect(buildTextSnapshot(document.querySelector("#focus")!, null)?.text).toBe(
    "Visible end",
  );
});

it("returns null for an invalid or detached source position", () => {
  document.body.innerHTML = '<p id="focus">Target</p>';
  const root = document.querySelector("#focus")!;
  const detached = document.createTextNode("Detached");
  expect(
    buildTextSnapshot(root, { textNode: root.firstChild as Text, offset: 6 }),
  ).toBeNull();
  expect(buildTextSnapshot(root, { textNode: detached, offset: 0 })).toBeNull();
});

it("returns null when a block has no eligible text", () => {
  document.body.innerHTML = '<p id="focus"><code>return</code></p>';
  expect(buildTextSnapshot(document.querySelector("#focus")!, null)).toBeNull();
});
```

- [ ] **Step 3: Run the tests and confirm the module is missing**

```bash
rtk npm test -- --run tests/text-snapshot.test.ts
```

Expected: FAIL because `text-snapshot.ts` does not exist.

- [ ] **Step 4: Implement deterministic block resolution**

Use the nearest ancestor in this semantic selector first:

```text
p, li, blockquote, figcaption, dt, dd, h1, h2, h3, h4, h5, h6, caption, td, th
```

Otherwise choose the nearest ancestor whose computed display is one of `block`, `flow-root`, `list-item`, `table-cell`, `table-caption`, `flex`, or `grid`. Never return `html` or `body`. Reading-region lookup uses the nearest `article`, `main`, `section`, `aside`, `nav`, `header`, or `footer`.

- [ ] **Step 5: Implement mapped normalization**

Walk DOM children in order. Prune nested logical blocks other than the root and subtrees rejected by `isVisibleContextText()`. Emit text-node characters directly, emit `\n` for every `<br>`, collapse whitespace originating from text nodes to one space, and trim the final leading/trailing normalized whitespace.

Track the normalized output length immediately before emitting the exact `(textNode, offset)` character. Return `null` when the requested source character is not visited or the source offset is invalid. Do not infer separators from element boundaries or CSS margins.

- [ ] **Step 6: Run focused and static checks**

```bash
rtk npm test -- --run tests/text-snapshot.test.ts tests/target-eligibility.test.ts
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 7: Commit mapped text snapshots**

```bash
rtk git add extension/src/text-snapshot.ts extension/tests/text-snapshot.test.ts
rtk git commit -m "feat(extension): normalize local DOM text"
```

---

### Task 5: Focused Word and Sentence Context

**Files:**

- Create: `extension/src/context-extraction.ts`
- Create: `extension/tests/context-extraction.test.ts`

**Interfaces:**

- Produces: `ContextBlock`, `FocusContextBlock`, and `DetectionContext` matching the approved design.
- Produces: `ContextLimits { readonly focusBlockCharacters: number; readonly neighborBlockCharacters: number }`.
- Produces: `extractTextContext(hit: TextHit, focusBlock: Element, limits?: ContextLimits): DetectionContext | null`.

Use the single `TextSpan` type imported from `word-segmentation.ts`:

```ts
export interface ContextBlock {
  readonly text: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
}

export interface FocusContextBlock extends ContextBlock {
  readonly word: TextSpan;
  readonly sentence: TextSpan;
}

export interface DetectionContext {
  readonly beforeBlocks: readonly ContextBlock[];
  readonly focusBlock: FocusContextBlock;
  readonly afterBlocks: readonly ContextBlock[];
}

export interface ContextLimits {
  readonly focusBlockCharacters: number;
  readonly neighborBlockCharacters: number;
}
```

- [ ] **Step 1: Write failing focus-context tests**

Create jsdom tests using small custom limits:

```ts
it("returns word and sentence spans inside normalized focus text", () => {
  document.body.innerHTML =
    '<p id="focus">Before. Turn the <strong>light</strong> off. After.</p>';
  const focusBlock = document.querySelector("#focus")!;
  const textNode = focusBlock.querySelector("strong")!.firstChild as Text;
  const hit = {
    textNode,
    characterOffset: 1,
    anchorRect: { x: 10, y: 10, width: 8, height: 16 },
  };

  expect(extractTextContext(hit, focusBlock)).toEqual({
    beforeBlocks: [],
    focusBlock: {
      text: "Before. Turn the light off. After.",
      word: { start: 17, end: 22 },
      sentence: { start: 8, end: 27 },
      truncatedBefore: false,
      truncatedAfter: false,
    },
    afterBlocks: [],
  });
});

it("detects a contraction split across inline nodes", () => {
  document.body.innerHTML =
    '<p id="focus">I <span>ca</span><em>n\'t</em> wait.</p>';
  const focusBlock = document.querySelector("#focus")!;
  const textNode = focusBlock.querySelector("span")!.firstChild as Text;
  const result = extractTextContext(
    {
      textNode,
      characterOffset: 1,
      anchorRect: { x: 10, y: 10, width: 8, height: 16 },
    },
    focusBlock,
  );
  expect(result).not.toBeNull();
  if (result === null) return;
  expect(
    result.focusBlock.text.slice(
      result.focusBlock.word.start,
      result.focusBlock.word.end,
    ),
  ).toBe("can't");
});

it.each([
  ["punctuation", "Hello, world.", 5],
  ["number", "Version 123.", 8],
  ["alphanumeric token", "Version abc123.", 9],
  ["non-Latin text", "Привет мир.", 0],
])("rejects %s", (_name, text, characterOffset) => {
  const textNode = document.createTextNode(text);
  const focusBlock = document.createElement("p");
  focusBlock.append(textNode);
  document.body.replaceChildren(focusBlock);
  expect(
    extractTextContext(
      {
        textNode,
        characterOffset,
        anchorRect: { x: 10, y: 10, width: 8, height: 16 },
      },
      focusBlock,
    ),
  ).toBeNull();
});

it("crops around the complete sentence and rebases both spans", () => {
  document.body.innerHTML =
    '<p id="focus">Long prefix words. Target sentence. Long suffix words.</p>';
  const focusBlock = document.querySelector("#focus")!;
  const textNode = focusBlock.firstChild as Text;
  const result = extractTextContext(
    {
      textNode,
      characterOffset: textNode.data.indexOf("Target") + 1,
      anchorRect: { x: 10, y: 10, width: 8, height: 16 },
    },
    focusBlock,
    { focusBlockCharacters: 24, neighborBlockCharacters: 8 },
  );
  expect(result).not.toBeNull();
  if (result === null) return;
  expect(result.focusBlock.text.length).toBeLessThanOrEqual(24);
  expect(
    result.focusBlock.text.slice(
      result.focusBlock.sentence.start,
      result.focusBlock.sentence.end,
    ),
  ).toBe("Target sentence.");
  expect(
    result.focusBlock.text.slice(
      result.focusBlock.word.start,
      result.focusBlock.word.end,
    ),
  ).toBe("Target");
  expect(result.focusBlock.truncatedBefore).toBe(true);
  expect(result.focusBlock.truncatedAfter).toBe(true);
});

it("returns null when the sentence alone exceeds the focus limit", () => {
  const textNode = document.createTextNode("This sentence is longer than ten.");
  const focusBlock = document.createElement("p");
  focusBlock.append(textNode);
  document.body.replaceChildren(focusBlock);
  expect(
    extractTextContext(
      {
        textNode,
        characterOffset: 1,
        anchorRect: { x: 10, y: 10, width: 8, height: 16 },
      },
      focusBlock,
      { focusBlockCharacters: 10, neighborBlockCharacters: 4 },
    ),
  ).toBeNull();
});

it("does not leave unpaired surrogates at crop boundaries", () => {
  document.body.innerHTML = '<p id="focus">😀😀. Target. 😀😀</p>';
  const focusBlock = document.querySelector("#focus")!;
  const textNode = focusBlock.firstChild as Text;
  const result = extractTextContext(
    {
      textNode,
      characterOffset: textNode.data.indexOf("Target") + 1,
      anchorRect: { x: 10, y: 10, width: 8, height: 16 },
    },
    focusBlock,
    { focusBlockCharacters: 12, neighborBlockCharacters: 4 },
  );
  expect(result).not.toBeNull();
  if (result === null) return;
  expect(result.focusBlock.text).not.toMatch(/^[\uDC00-\uDFFF]/u);
  expect(result.focusBlock.text).not.toMatch(/[\uD800-\uDBFF]$/u);
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

```bash
rtk npm test -- --run tests/context-extraction.test.ts
```

Expected: FAIL because `context-extraction.ts` does not exist.

- [ ] **Step 3: Implement focus extraction before neighbors**

Set defaults to 4,000 focus characters and 2,000 neighbor characters. Build the mapped focus snapshot, derive the English word span at `sourceOffset`, then derive the trimmed sentence span at `word.start`.

If the sentence exceeds the focus limit, return `null`. Otherwise select a focus window that contains the complete sentence, shares remaining capacity before and after it, shifts unused capacity to the other side, and then rebases both spans. Adjust cut boundaries so neither begins with a low surrogate nor ends with an unmatched high surrogate. Trim crop-edge whitespace and rebase again.

Return empty neighbor arrays in this task; Task 6 fills them without changing the contract.

- [ ] **Step 4: Assert context invariants in one internal guard**

Before returning, verify word and sentence bounds are integral, non-empty, in range, and nested correctly. Return `null` rather than throwing if an invariant fails.

- [ ] **Step 5: Run focused and static checks**

```bash
rtk npm test -- --run tests/context-extraction.test.ts tests/sentence-segmentation.test.ts tests/word-segmentation.test.ts
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 6: Commit focused context extraction**

```bash
rtk git add extension/src/context-extraction.ts extension/tests/context-extraction.test.ts
rtk git commit -m "feat(extension): extract focused sentence context"
```

---

### Task 6: Neighboring Context Blocks

**Files:**

- Modify: `extension/src/context-extraction.ts`
- Modify: `extension/tests/context-extraction.test.ts`

**Interfaces:**

- Preserves: `extractTextContext(...)` and all public context types from Task 5.
- Adds behavior: nearest eligible previous and next logical blocks in the same reading region or parent flow.

- [ ] **Step 1: Add failing neighbor-selection tests**

```ts
const extractFixtureContext = (
  selector: string,
  word: string,
  limits?: ContextLimits,
): DetectionContext | null => {
  const focusBlock = document.querySelector(selector)!;
  const walker = document.createTreeWalker(focusBlock, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode() as Text | null;
  while (textNode !== null && !textNode.data.includes(word)) {
    textNode = walker.nextNode() as Text | null;
  }
  if (textNode === null) {
    throw new Error(`Fixture word not found: ${word}`);
  }
  return extractTextContext(
    {
      textNode,
      characterOffset: textNode.data.indexOf(word) + 1,
      anchorRect: { x: 10, y: 10, width: 8, height: 16 },
    },
    focusBlock,
    limits,
  );
};

it("collects one previous and one next block in DOM reading order", () => {
  document.body.innerHTML = `
    <article>
      <p>Previous paragraph.</p>
      <p id="focus">Click the target word.</p>
      <p>Next paragraph.</p>
      <p>Too far away.</p>
    </article>
  `;

  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks).toEqual([
    {
      text: "Previous paragraph.",
      truncatedBefore: false,
      truncatedAfter: false,
    },
  ]);
  expect(result?.afterBlocks).toEqual([
    { text: "Next paragraph.", truncatedBefore: false, truncatedAfter: false },
  ]);
});

it("does not cross into a nested aside or another section", () => {
  document.body.innerHTML = `
    <article>
      <p>Previous article text.</p>
      <aside><p>Aside text.</p></aside>
      <p id="focus">Click the target word.</p>
      <section><p>Other section text.</p></section>
      <p>Next article text.</p>
    </article>
  `;
  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks[0]?.text).toBe("Previous article text.");
  expect(result?.afterBlocks[0]?.text).toBe("Next article text.");
});

it("keeps the previous suffix and next prefix at the neighbor limit", () => {
  document.body.innerHTML = `
    <article>
      <p>xxx😀near</p>
      <p id="focus">Click the target word.</p>
      <p>near😀xxx</p>
    </article>
  `;
  const result = extractFixtureContext("#focus", "target", {
    focusBlockCharacters: 40,
    neighborBlockCharacters: 5,
  });
  expect(result?.beforeBlocks).toEqual([
    { text: "near", truncatedBefore: true, truncatedAfter: false },
  ]);
  expect(result?.afterBlocks).toEqual([
    { text: "near", truncatedBefore: false, truncatedAfter: true },
  ]);
});

it("skips hidden, code-only, and empty candidate blocks", () => {
  document.body.innerHTML = `
    <article>
      <p>Previous visible.</p>
      <p hidden>Hidden.</p>
      <p><code>return</code></p>
      <p></p>
      <p id="focus">Click the target word.</p>
      <p>Next visible.</p>
    </article>
  `;
  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks[0]?.text).toBe("Previous visible.");
  expect(result?.afterBlocks[0]?.text).toBe("Next visible.");
});

it("collects no neighbors when the fallback parent is body", () => {
  document.body.innerHTML = `
    <p>Previous.</p>
    <p id="focus">Click the target word.</p>
    <p>Next.</p>
  `;
  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks).toEqual([]);
  expect(result?.afterBlocks).toEqual([]);
});

it("keeps a nested list item separate from its parent list item", () => {
  document.body.innerHTML = `
    <section>
      <ul>
        <li>Parent text<ul><li>Nested text.</li></ul></li>
        <li id="focus">Click the target word.</li>
      </ul>
    </section>
  `;
  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks[0]?.text).toBe("Nested text.");
});

it("uses an empty array for a missing side", () => {
  document.body.innerHTML = `
    <article>
      <p id="focus">Click the target word.</p>
      <p>Only next text.</p>
    </article>
  `;
  const result = extractFixtureContext("#focus", "target");
  expect(result?.beforeBlocks).toEqual([]);
  expect(result?.afterBlocks[0]?.text).toBe("Only next text.");
});
```

- [ ] **Step 2: Run the focused tests and confirm neighbors are empty**

```bash
rtk npm test -- --run tests/context-extraction.test.ts
```

Expected: FAIL on the new neighbor expectations.

- [ ] **Step 3: Implement local neighbor traversal**

Choose the nearest reading region from `article`, `main`, `section`, `aside`, `nav`, `header`, or `footer`; otherwise use the focus block parent unless it is `html` or `body`.

Starting from the hit text node, walk text nodes backward or forward in DOM order. Skip nodes inside the focus block. Resolve each candidate's logical block and accept the first distinct block whose nearest reading region is identical to the focus region, or whose fallback parent flow is the same when neither has a region. Build its snapshot and skip empty or unsupported candidates.

- [ ] **Step 4: Implement directional neighbor truncation**

For the previous block keep the suffix nearest the focus and set `truncatedBefore`. For the next block keep the prefix and set `truncatedAfter`. Adjust boundaries to remove an entire split surrogate pair, trim crop-edge whitespace, and never return an empty block. The maximum total text length is therefore `focusLimit + 2 * neighborLimit`.

- [ ] **Step 5: Run focused and complete checks**

```bash
rtk npm test -- --run tests/context-extraction.test.ts tests/text-snapshot.test.ts
rtk npm run check
```

Expected: all checks pass.

- [ ] **Step 6: Commit neighboring context**

```bash
rtk git add extension/src/context-extraction.ts extension/tests/context-extraction.test.ts
rtk git commit -m "feat(extension): collect neighboring context blocks"
```

---

### Task 7: Public Detection Pipeline and Browser Entry

**Files:**

- Create: `extension/src/detection.ts`
- Create: `extension/tests/detection.test.ts`
- Modify: `extension/src/content.ts`

**Interfaces:**

- Produces: `DetectionInput { readonly point: ViewportPoint; readonly target: EventTarget | null; readonly eventPath: readonly EventTarget[] }`.
- Produces: `DetectionResult { readonly anchorRect: ViewportRect; readonly context: DetectionContext }`.
- Produces: `detectEnglishContext(input: DetectionInput, documentRoot?: Document): DetectionResult | null`.

Define the public contract exactly once in `detection.ts`:

```ts
export interface DetectionInput {
  readonly point: ViewportPoint;
  readonly target: EventTarget | null;
  readonly eventPath: readonly EventTarget[];
}

export interface DetectionResult {
  readonly anchorRect: ViewportRect;
  readonly context: DetectionContext;
}
```

- [ ] **Step 1: Write failing full-pipeline tests**

Create `tests/detection.test.ts` with jsdom and shared caret stubs:

```ts
it("returns a complete serializable detection result", () => {
  document.body.innerHTML = `
    <article>
      <p>Previous context.</p>
      <p id="focus">Turn the <strong>light</strong> off.</p>
      <p>Next context.</p>
    </article>
  `;
  const target = document.querySelector("strong")!;
  const textNode = target.firstChild as Text;
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));

  const result = detectEnglishContext(
    {
      point: { clientX: 15, clientY: 15 },
      target,
      eventPath: [
        target,
        document.querySelector("#focus")!,
        document.body,
        document,
      ],
    },
    document,
  );

  expect(result?.context.focusBlock.text).toBe("Turn the light off.");
  expect(result?.context.focusBlock.word).toEqual({ start: 9, end: 14 });
  expect(result?.anchorRect).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

it("returns null when hit-testing fails", () => {
  expect(
    detectEnglishContext(
      {
        point: { clientX: Number.NaN, clientY: 15 },
        target: null,
        eventPath: [],
      },
      document,
    ),
  ).toBeNull();
});

it("returns null when body would be the only focus block", () => {
  const textNode = document.createTextNode("Target");
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
  expect(
    detectEnglishContext(
      {
        point: { clientX: 15, clientY: 15 },
        target: document.body,
        eventPath: [document.body, document, window],
      },
      document,
    ),
  ).toBeNull();
});

it("returns null when the event path identifies an overlay button", () => {
  document.body.innerHTML =
    '<p id="focus">Target</p><button id="overlay">Overlay</button>';
  const textNode = document.querySelector("#focus")!.firstChild as Text;
  const overlay = document.querySelector("#overlay")!;
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
  expect(
    detectEnglishContext(
      {
        point: { clientX: 15, clientY: 15 },
        target: overlay,
        eventPath: [overlay, document.body, document, window],
      },
      document,
    ),
  ).toBeNull();
});

it("returns null for hidden target text", () => {
  document.body.innerHTML = '<p id="focus" hidden>Target</p>';
  const focus = document.querySelector("#focus")!;
  const textNode = focus.firstChild as Text;
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
  expect(
    detectEnglishContext(
      {
        point: { clientX: 15, clientY: 15 },
        target: focus,
        eventPath: [focus, document.body, document, window],
      },
      document,
    ),
  ).toBeNull();
});

it("returns null when context contains no accepted English word", () => {
  document.body.innerHTML = '<p id="focus">123</p>';
  const focus = document.querySelector("#focus")!;
  const textNode = focus.firstChild as Text;
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
  expect(
    detectEnglishContext(
      {
        point: { clientX: 15, clientY: 15 },
        target: focus,
        eventPath: [focus, document.body, document, window],
      },
      document,
    ),
  ).toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm the public module is missing**

```bash
rtk npm test -- --run tests/detection.test.ts
```

Expected: FAIL because `detection.ts` does not exist.

- [ ] **Step 3: Implement the public orchestrator**

Implement this exact order:

```text
findTextHitAtPoint
→ findFocusBlock
→ isEligibleTextTarget using target and eventPath
→ extractTextContext
→ { anchorRect: hit.anchorRect, context }
```

Return `null` immediately after any failed mandatory stage. Re-export the context and geometry types needed by later consumers; do not expose `Text`, `Element`, `Range`, or other DOM values in `DetectionResult`.

- [ ] **Step 4: Replace temporary content wiring**

Update the handler to call `detectEnglishContext()` with `event.clientX`, `event.clientY`, `event.target`, and `event.composedPath()`. Slice the word from the normalized focus text and preserve the exact successful log:

```ts
console.log("[TapTranslate] Detected word:", word);
```

Wrap detection in one entry-boundary `try/catch`. Unexpected failures may log the fixed message `[TapTranslate] Unexpected detection failure.` but must not include the event target, page text, or caught error object. Keep the listener passive and capture-phase.

- [ ] **Step 5: Run focused and complete checks**

```bash
rtk npm test -- --run tests/detection.test.ts
rtk npm run check
```

Expected: all tests pass and the production bundle still builds without warnings.

- [ ] **Step 6: Commit the public pipeline**

```bash
rtk git add extension/src/detection.ts extension/src/content.ts extension/tests/detection.test.ts
rtk git commit -m "feat(extension): wire context detection pipeline"
```

---

### Task 8: Manual Safari Fixture and Release Verification

**Files:**

- Modify: `extension/package.json`
- Modify: `extension/package-lock.json` only if npm normalizes it after the script change; normally no lockfile change is expected.
- Create: `extension/tests/fixtures/index.html`

**Interfaces:**

- Produces: `npm run fixture`, serving the fixture at `http://127.0.0.1:5173` through the already installed Vite CLI.
- Preserves: the exact three-file production artifact contract.

- [ ] **Step 1: Create the manual fixture**

Create one accessible HTML page with labelled sections containing:

- a plain paragraph with multiple sentences;
- `Turn the light off before leaving.` split across `span`, `strong`, and `em` nodes;
- a straight and curly apostrophe contraction;
- a heading, list item, quotation, caption, and table cell;
- previous/focus/next paragraphs inside one article;
- a nested aside and a second section to expose context leakage;
- a link, button, label/input, `contenteditable`, ARIA button, `tabindex="0"`, inline `onclick`, hidden text, code, and preformatted code;
- a noninteractive glossary term styled only with `cursor: pointer`;
- punctuation, whitespace, numbers, alphanumeric tokens, and non-Latin text;
- a page click counter proving normal bubbling behavior remains intact.

The fixture includes no extension code and no backend call.

- [ ] **Step 2: Add the fixture script**

Add to `package.json`:

```json
"fixture": "vite tests/fixtures --host 127.0.0.1 --strictPort"
```

Do not place the fixture under `public/`, because Vite would copy it into `dist`.

- [ ] **Step 3: Run the complete automated verification suite**

```bash
rtk npm run format
rtk npm run check
rtk npm ls --omit=dev --depth=0
```

Expected: formatting, ESLint, strict TypeScript, all Vitest files, and the production build pass; the production dependency tree is empty.

- [ ] **Step 4: Inspect the production artifact contract**

```bash
rtk rg --files dist
rtk node --check dist/content.js
rtk jq -e '.manifest_version == 3 and .content_scripts[0].js == ["content.js"]' dist/manifest.json
rtk git diff --check
```

Expected files only:

```text
dist/content.js
dist/content.js.map
dist/manifest.json
```

- [ ] **Step 5: Commit the fixture and verified scripts**

```bash
rtk git add extension/package.json extension/package-lock.json extension/tests/fixtures/index.html
rtk git commit -m "test(extension): add Safari context fixture"
```

- [ ] **Step 6: Run the required desktop Safari acceptance**

Run `rtk npm run fixture`, reload `extension/dist` as the temporary extension, grant site access, open `http://127.0.0.1:5173`, and use Web Inspector Console.

Expected:

- one complete-word log for every eligible plain or formatted word;
- no log for punctuation, whitespace, numbers, alphanumeric tokens, non-Latin text, apostrophes, interactive targets, editable text, hidden text, or code;
- the `cursor: pointer` glossary term remains eligible;
- links, controls, selection, and the page click counter retain normal behavior;
- no unexpected TapTranslate error appears.

Repeat a smoke check on one article, one documentation page, one search page, and one dynamically rendered page. Record any reproducible failure before merging the branch.

---

## Completion Criteria

- All eight tasks have one passing TDD cycle and one focused commit.
- `rtk npm run check` passes from `extension/`.
- The production dependency tree is empty.
- `dist` contains only `content.js`, `content.js.map`, and `manifest.json`.
- The public result is serializable and satisfies all word, sentence, geometry, size, and privacy invariants.
- The user completes the desktop Safari fixture and real-site acceptance before the feature branch is merged.
