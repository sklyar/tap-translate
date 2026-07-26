# Accepted Hit Debug Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a temporary expanding ring for every successful TapTranslate detection and keep the fixture click counter visible while scrolling.

**Architecture:** A small best-effort renderer consumes only the existing `ViewportRect`, appends one empty noninteractive element, animates it with inline styles, and removes it. The content entry point invokes it only after the detection pipeline succeeds; detection contracts remain unchanged.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10 with jsdom 28.1.0, Vite 8.1.5, Safari 15.4 and iOS 15.4.

## Global Constraints

- This is temporary debug behavior on every supported page, not translation UI.
- Add no dependency and no page text to the effect element.
- Do not call `preventDefault()` or `stopPropagation()`.
- The effect must use `pointer-events: none`, fixed viewport coordinates, and guaranteed cleanup.
- Rendering failures must not affect detection or the host page.

---

### Task 1: Render and Wire the Accepted-Hit Ring

**Files:**

- Create: `extension/src/accepted-hit-effect.ts`
- Create: `extension/tests/accepted-hit-effect.test.ts`
- Modify: `extension/src/content.ts`
- Modify: `extension/tests/fixtures/index.html`

**Interfaces:**

- Consumes: `ViewportRect` from `extension/src/hit-testing.ts`.
- Produces: `showAcceptedHitEffect(rect: ViewportRect, documentRoot?: Document): void`.

- [ ] **Step 1: Write failing DOM tests**

Create `tests/accepted-hit-effect.test.ts` in the jsdom environment. Stub
`requestAnimationFrame()` to run immediately and use fake timers. Assert that a
valid rectangle creates `[data-taptranslate-hit-effect]` centered at
`x + width / 2`, `y + height / 2`, with fixed positioning,
`pointer-events: none`, `aria-hidden="true"`, the final faded/expanded styles,
and removal after 550 milliseconds. Add a table test proving non-finite or
non-positive rectangles create nothing.

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
rtk npm test -- --run tests/accepted-hit-effect.test.ts
```

Expected: FAIL because `src/accepted-hit-effect.ts` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `showAcceptedHitEffect()` with this behavior:

```ts
import type { ViewportRect } from './hit-testing';

const cleanupDelayMilliseconds = 550;

export function showAcceptedHitEffect(
  rect: ViewportRect,
  documentRoot: Document = document,
): void {
  if (!isValidRect(rect)) {
    return;
  }

  try {
    const ring = documentRoot.createElement('div');
    ring.setAttribute('data-taptranslate-hit-effect', '');
    ring.setAttribute('aria-hidden', 'true');

    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const styles = {
      all: 'initial',
      position: 'fixed',
      display: 'block',
      left: `${String(centerX)}px`,
      top: `${String(centerY)}px`,
      width: '24px',
      height: '24px',
      margin: '0',
      padding: '0',
      boxSizing: 'border-box',
      background: 'transparent',
      border: '2px solid #22c55e',
      borderRadius: '9999px',
      pointerEvents: 'none',
      zIndex: '2147483647',
      opacity: '1',
      transform: 'translate(-50%, -50%) scale(0.35)',
      transformOrigin: 'center',
      transition: 'transform 450ms ease-out, opacity 450ms ease-out',
    } as const;

    for (const [property, value] of Object.entries(styles)) {
      ring.style.setProperty(toKebabCase(property), value, 'important');
    }

    documentRoot.documentElement.append(ring);
    globalThis.setTimeout(() => {
      ring.remove();
    }, cleanupDelayMilliseconds);

    // Commit the initial scale before changing it on the next frame.
    ring.getBoundingClientRect();

    const animate = () => {
      ring.style.setProperty(
        'transform',
        'translate(-50%, -50%) scale(1.8)',
        'important',
      );
      ring.style.setProperty('opacity', '0', 'important');
    };

    const view = documentRoot.defaultView;
    if (view === null) {
      animate();
    } else {
      view.requestAnimationFrame(animate);
    }
  } catch {
    // Debug rendering is best effort and never affects the page.
  }
}

function isValidRect(rect: ViewportRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
```

Use no class name, stylesheet, Shadow DOM, canvas, or page event.

- [ ] **Step 4: Wire only successful detection**

Import `showAcceptedHitEffect` in `content.ts` and call it after the existing
`result === null` return and before the successful word log:

```ts
showAcceptedHitEffect(result.anchorRect);
```

Do not change the passive capture listener or logging behavior.

- [ ] **Step 5: Fix the fixture counter**

Change `#click-counter` from `position: sticky` to `position: fixed`, place it at
`top: 0.75rem; right: 0.75rem`, and give it a high fixture-only z-index. Its
meaning remains “all bubbled page clicks,” not accepted detections.

- [ ] **Step 6: Run focused and complete verification**

Run:

```bash
rtk npm run format
rtk npm test -- --run tests/accepted-hit-effect.test.ts tests/detection.test.ts
rtk npm run check
rtk npm ls --omit=dev --depth=0
rtk rg --files dist
rtk node --check dist/content.js
rtk git diff --check
```

Expected: all checks pass, production dependencies remain empty, and `dist`
still contains only `content.js`, `content.js.map`, and `manifest.json`.

- [ ] **Step 7: Commit**

```bash
rtk git add extension/src/accepted-hit-effect.ts extension/src/content.ts extension/tests/accepted-hit-effect.test.ts extension/tests/fixtures/index.html
rtk git commit -m "feat(extension): show accepted hit effect"
```
