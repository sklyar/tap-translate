# Shared Character Boundary Hit

## Problem

Adjacent character rectangles share an edge. The current hit test includes both
the left/right and top/bottom edges, so a pointer exactly between letters matches
both characters. The ambiguity guard then rejects the click and no accepted-hit
effect appears.

## Change

Treat character rectangles as half-open regions:

```text
left <= x < right
top <= y < bottom
```

The shared vertical edge therefore belongs to the character on the right, and a
shared horizontal edge belongs to the character below. This is deterministic and
does not require an arbitrary pixel tolerance.

True overlap remains fail-closed. If two character rectangles both contain a
point inside their area, hit-testing still returns `null`. Word segmentation,
eligibility, context extraction, and public contracts do not change.

## Verification

Add a regression test with adjacent non-overlapping character rectangles sharing
one edge and assert that the right-hand character is selected. Preserve the
existing test where two rectangles fully overlap and assert that it remains
ambiguous.
