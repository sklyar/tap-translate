export interface ViewportPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextHit {
  readonly textNode: Text;
  readonly characterOffset: number;
  readonly anchorRect: ViewportRect;
}

interface TextPosition {
  readonly node: Node;
  readonly offset: number;
}

interface PointToCaretDocument {
  caretPositionFromPoint?: (
    clientX: number,
    clientY: number,
  ) => { readonly offsetNode: Node; readonly offset: number } | null;
  caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
}

function resolveTextPosition(
  documentRoot: Document,
  { clientX, clientY }: ViewportPoint,
): TextPosition | null {
  const pointToCaretDocument = documentRoot as unknown as PointToCaretDocument;

  if (typeof pointToCaretDocument.caretPositionFromPoint === 'function') {
    const position = pointToCaretDocument.caretPositionFromPoint(
      clientX,
      clientY,
    );

    return position === null
      ? null
      : { node: position.offsetNode, offset: position.offset };
  }

  if (typeof pointToCaretDocument.caretRangeFromPoint === 'function') {
    const range = pointToCaretDocument.caretRangeFromPoint(clientX, clientY);

    return range === null
      ? null
      : { node: range.startContainer, offset: range.startOffset };
  }

  return null;
}

function matchingCharacterRectangles(
  documentRoot: Document,
  textNode: Text,
  characterOffset: number,
  { clientX, clientY }: ViewportPoint,
): readonly ViewportRect[] {
  const range = documentRoot.createRange();
  range.setStart(textNode, characterOffset);
  range.setEnd(textNode, characterOffset + 1);

  return Array.from(range.getClientRects())
    .filter(
      (rectangle) =>
        Number.isFinite(rectangle.x) &&
        Number.isFinite(rectangle.y) &&
        Number.isFinite(rectangle.width) &&
        Number.isFinite(rectangle.height) &&
        Number.isFinite(rectangle.left) &&
        Number.isFinite(rectangle.right) &&
        Number.isFinite(rectangle.top) &&
        Number.isFinite(rectangle.bottom) &&
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        clientX >= rectangle.left &&
        clientX <= rectangle.right &&
        clientY >= rectangle.top &&
        clientY <= rectangle.bottom,
    )
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
}

function resolveTextHit(
  documentRoot: Document,
  textNode: Text,
  caretOffset: number,
  point: ViewportPoint,
): TextHit | null {
  if (
    !Number.isInteger(caretOffset) ||
    caretOffset < 0 ||
    caretOffset > textNode.length
  ) {
    return null;
  }

  const matches: TextHit[] = [];

  for (const characterOffset of [caretOffset, caretOffset - 1]) {
    if (characterOffset < 0 || characterOffset >= textNode.length) {
      continue;
    }

    for (const anchorRect of matchingCharacterRectangles(
      documentRoot,
      textNode,
      characterOffset,
      point,
    )) {
      matches.push({ textNode, characterOffset, anchorRect });
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function findTextHitAtPoint(
  point: ViewportPoint,
  documentRoot: Document = document,
): TextHit | null {
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    return null;
  }

  try {
    const textPosition = resolveTextPosition(documentRoot, point);

    if (textPosition?.node.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    return resolveTextHit(
      documentRoot,
      textPosition.node as Text,
      textPosition.offset,
      point,
    );
  } catch {
    return null;
  }
}
