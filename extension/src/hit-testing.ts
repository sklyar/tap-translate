import { getEnglishWordAtOffset } from './word-segmentation';

export interface ViewportPoint {
  readonly clientX: number;
  readonly clientY: number;
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

function characterContainsPoint(
  documentRoot: Document,
  textNode: Text,
  characterOffset: number,
  { clientX, clientY }: ViewportPoint,
): boolean {
  const range = documentRoot.createRange();
  range.setStart(textNode, characterOffset);
  range.setEnd(textNode, characterOffset + 1);

  return Array.from(range.getClientRects()).some(
    (rectangle) =>
      rectangle.width > 0 &&
      rectangle.height > 0 &&
      clientX >= rectangle.left &&
      clientX <= rectangle.right &&
      clientY >= rectangle.top &&
      clientY <= rectangle.bottom,
  );
}

function resolveCharacterOffset(
  documentRoot: Document,
  textNode: Text,
  caretOffset: number,
  point: ViewportPoint,
): number | null {
  if (
    !Number.isInteger(caretOffset) ||
    caretOffset < 0 ||
    caretOffset > textNode.length
  ) {
    return null;
  }

  const candidates = [caretOffset, caretOffset - 1];
  let matchedOffset: number | null = null;

  for (const candidate of candidates) {
    if (
      candidate < 0 ||
      candidate >= textNode.length ||
      !characterContainsPoint(documentRoot, textNode, candidate, point)
    ) {
      continue;
    }

    if (matchedOffset !== null && matchedOffset !== candidate) {
      return null;
    }

    matchedOffset = candidate;
  }

  return matchedOffset;
}

export function findEnglishWordAtPoint(
  point: ViewportPoint,
  documentRoot: Document = document,
): string | null {
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    return null;
  }

  const textPosition = resolveTextPosition(documentRoot, point);

  if (textPosition?.node.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textNode = textPosition.node as Text;
  const characterOffset = resolveCharacterOffset(
    documentRoot,
    textNode,
    textPosition.offset,
    point,
  );

  return characterOffset === null
    ? null
    : getEnglishWordAtOffset(textNode.data, characterOffset);
}
