# Shared Character Boundary Hit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept a pointer exactly on the shared edge between adjacent character rectangles without accepting truly overlapping characters.

**Architecture:** Keep the existing two-candidate geometric validation and ambiguity guard. Change only rectangle containment from closed to half-open right/bottom boundaries.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10 with jsdom 28.1.0, Safari 15.4 and iOS 15.4.

## Global Constraints

- Preserve `caretPositionFromPoint()` precedence and the WebKit fallback.
- Preserve `null` for truly overlapping character rectangles.
- Do not change word segmentation, eligibility, context extraction, or public contracts.
- Add no dependency.

---

### Task 1: Use Half-Open Character Rectangles

**Files:**

- Modify: `extension/src/hit-testing.ts`
- Modify: `extension/tests/hit-testing.test.ts`

**Interfaces:**

- Preserves: `findTextHitAtPoint(point: ViewportPoint, documentRoot?: Document): TextHit | null`.

- [ ] **Step 1: Add the failing regression test**

Add this case beside the existing overlapping-character test:

```ts
it('assigns a shared character edge to the character on the right', () => {
  const textNode = document.createTextNode('Hello');
  document.body.replaceChildren(textNode);
  setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
  const rightRect = {
    ...TEST_RECT,
    x: 20,
    left: 20,
    right: 30,
  };
  stubCharacterRectangles(
    document,
    new Map([
      [0, [TEST_RECT]],
      [1, [rightRect]],
    ]),
  );

  expect(findTextHitAtPoint({ clientX: 20, clientY: 15 }, document)).toEqual({
    textNode,
    characterOffset: 1,
    anchorRect: { x: 20, y: 10, width: 10, height: 10 },
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the regression**

Run:

```bash
rtk npm test -- --run tests/hit-testing.test.ts
```

Expected: the new case fails with `received null`; the existing full-overlap
case still passes.

- [ ] **Step 3: Make right and bottom edges exclusive**

In `matchingCharacterRectangles()`, change only these comparisons:

```ts
clientX >= rectangle.left &&
clientX < rectangle.right &&
clientY >= rectangle.top &&
clientY < rectangle.bottom
```

- [ ] **Step 4: Run complete verification**

Run:

```bash
rtk npm test -- --run tests/hit-testing.test.ts tests/detection.test.ts
rtk npm run check
rtk npm ls --omit=dev --depth=0
rtk rg --files dist
rtk node --check dist/content.js
rtk git diff --check
```

Expected: all tests pass, the production dependency tree remains empty, and
`dist` still contains only `content.js`, `content.js.map`, and `manifest.json`.

- [ ] **Step 5: Commit**

```bash
rtk git add extension/src/hit-testing.ts extension/tests/hit-testing.test.ts
rtk git commit -m "fix(extension): accept shared character edges"
```
