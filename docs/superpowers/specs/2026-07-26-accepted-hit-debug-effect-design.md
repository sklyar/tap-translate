# Accepted Hit Debug Effect

## Purpose

Temporarily show whether TapTranslate accepted a click as an ordinary English
word without requiring the Safari console. This is debugging behavior, not the
translation UI.

The existing page click counter remains independent: it counts every bubbled
page click, including links and buttons. The new effect appears only after the
extension produces a successful `DetectionResult`.

## Behavior

- Show a green ring centered on the exact clicked-character `anchorRect`.
- Expand and fade the ring over approximately 450 milliseconds.
- Render it on every supported page while this debug behavior is enabled.
- Do not show it for links, buttons, editable content, rejected tokens, or any
  other failed detection.
- Do not alter selection, navigation, event propagation, page layout, or pointer
  handling.
- Remove every ring after the animation, including a timeout fallback.

The acceptance fixture's page-click counter becomes `position: fixed` in the
top-right corner so it remains visible while scrolling.

## Implementation

Add one small renderer that receives only `ViewportRect`. It creates a single
empty `div` under `document.documentElement`, applies all required styles
inline, sets `aria-hidden="true"` and `pointer-events: none`, starts the effect
on the next animation frame, and removes the element after a timeout.

The renderer validates finite positive geometry and catches DOM failures. The
content entry point invokes it only after `detectEnglishContext()` succeeds.
Detection, context extraction, and the serializable public result remain
unchanged. No page text is placed in the effect element.

## Verification

DOM tests cover successful creation, geometry, non-interactive styling,
animation transition, cleanup, and invalid rectangles. Existing pipeline tests
continue to prove that rejected targets return `null`. The complete extension
verification suite and desktop Safari fixture acceptance must pass.
