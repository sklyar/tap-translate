import { vi } from 'vitest';

export const TEST_RECT = {
  x: 10,
  y: 10,
  width: 10,
  height: 10,
  top: 10,
  right: 20,
  bottom: 20,
  left: 10,
  toJSON: () => ({}),
} satisfies DOMRect;

interface CaretPositionResult {
  readonly offsetNode: Node;
  readonly offset: number;
}

export function setCaretPositionFromPoint(
  documentRoot: Document,
  result: CaretPositionResult | null,
): void {
  Object.defineProperty(documentRoot, 'caretPositionFromPoint', {
    configurable: true,
    value: vi.fn(() => result),
  });
}

export function setCaretRangeFromPoint(
  documentRoot: Document,
  textNode: Text,
  offset: number,
): void {
  Object.defineProperty(documentRoot, 'caretRangeFromPoint', {
    configurable: true,
    value: vi.fn(
      () =>
        ({
          startContainer: textNode,
          startOffset: offset,
        }) as unknown as Range,
    ),
  });
}

export function stubCharacterRectangles(
  documentRoot: Document,
  rectanglesByOffset: ReadonlyMap<number, readonly DOMRect[]>,
): void {
  vi.spyOn(documentRoot, 'createRange').mockImplementation(() => {
    let characterOffset = -1;

    return {
      setStart: (_node: Node, offset: number) => {
        characterOffset = offset;
      },
      setEnd: () => undefined,
      getClientRects: () =>
        toDomRectList(rectanglesByOffset.get(characterOffset) ?? []),
    } as unknown as Range;
  });
}

function toDomRectList(rectangles: readonly DOMRect[]): DOMRectList {
  const list = [...rectangles] as DOMRect[] & {
    item(index: number): DOMRect | null;
  };
  list.item = (index) => list[index] ?? null;
  return list;
}
