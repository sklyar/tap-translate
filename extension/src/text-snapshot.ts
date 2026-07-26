import {
  isVisibleContextElement,
  isVisibleContextText,
} from './target-eligibility';

export interface SourcePosition {
  readonly textNode: Text;
  readonly offset: number;
}

export interface TextSnapshot {
  readonly text: string;
  readonly sourceOffset: number | null;
}

const semanticBlockSelector = [
  'p',
  'li',
  'blockquote',
  'figcaption',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'caption',
  'td',
  'th',
].join(',');

const readingRegionSelector = 'article,main,section,aside,nav,header,footer';

const logicalDisplays = new Set([
  'block',
  'flow-root',
  'list-item',
  'table-cell',
  'table-caption',
  'flex',
  'grid',
]);

interface SnapshotState {
  readonly output: string[];
  pendingSpace: boolean;
  sourceVisited: boolean;
  sourceOffset: number | null;
}

export function findFocusBlock(textNode: Text): Element | null {
  const parent = textNode.parentElement;
  if (parent === null) {
    return null;
  }

  const semanticBlock = parent.closest(semanticBlockSelector);
  if (semanticBlock !== null) {
    return semanticBlock;
  }

  for (
    let element: Element | null = parent;
    element !== null;
    element = element.parentElement
  ) {
    if (isDocumentBoundary(element)) {
      return null;
    }

    if (hasLogicalDisplay(element)) {
      return element;
    }
  }

  return null;
}

export function findReadingRegion(element: Element): Element | null {
  return element.closest(readingRegionSelector);
}

export function buildTextSnapshot(
  root: Element,
  source: SourcePosition | null,
): TextSnapshot | null {
  if (
    !isVisibleContextElement(root) ||
    (source !== null && !isValidSource(root, source))
  ) {
    return null;
  }

  const state: SnapshotState = {
    output: [],
    pendingSpace: false,
    sourceVisited: false,
    sourceOffset: null,
  };

  visitChildren(root, root, source, state);

  if (source !== null && !state.sourceVisited) {
    return null;
  }

  const rawText = state.output.join('');
  const trimStart = leadingWhitespaceLength(rawText);
  const trimEnd = trailingWhitespaceStart(rawText, trimStart);
  const text = rawText.slice(trimStart, trimEnd);

  if (text.length === 0) {
    return null;
  }

  if (source === null) {
    return { text, sourceOffset: null };
  }

  if (
    state.sourceOffset === null ||
    state.sourceOffset < trimStart ||
    state.sourceOffset >= trimEnd
  ) {
    return null;
  }

  return {
    text,
    sourceOffset: state.sourceOffset - trimStart,
  };
}

function visitChildren(
  parent: Element,
  root: Element,
  source: SourcePosition | null,
  state: SnapshotState,
): void {
  for (const child of parent.childNodes) {
    if (child instanceof Text) {
      visitText(child, source, state);
      continue;
    }

    if (!(child instanceof Element) || !isVisibleContextElement(child)) {
      continue;
    }

    if (child.tagName === 'BR') {
      state.pendingSpace = false;
      state.output.push('\n');
      continue;
    }

    if (child !== root && isLogicalBlock(child)) {
      continue;
    }

    visitChildren(child, root, source, state);
  }
}

function visitText(
  textNode: Text,
  source: SourcePosition | null,
  state: SnapshotState,
): void {
  if (!isVisibleContextText(textNode)) {
    return;
  }

  for (let offset = 0; offset < textNode.length; offset += 1) {
    const character = textNode.data[offset];
    const isSourceCharacter =
      source?.textNode === textNode && source.offset === offset;

    if (isSourceCharacter) {
      state.sourceVisited = true;
    }

    if (character === undefined || /\s/.test(character)) {
      state.pendingSpace = true;
      continue;
    }

    flushPendingSpace(state);

    if (isSourceCharacter) {
      state.sourceOffset = state.output.length;
    }

    state.output.push(character);
  }
}

function flushPendingSpace(state: SnapshotState): void {
  if (
    state.pendingSpace &&
    state.output.length > 0 &&
    state.output[state.output.length - 1] !== '\n'
  ) {
    state.output.push(' ');
  }
  state.pendingSpace = false;
}

function isValidSource(root: Element, source: SourcePosition): boolean {
  return (
    root.contains(source.textNode) &&
    Number.isInteger(source.offset) &&
    source.offset >= 0 &&
    source.offset < source.textNode.length
  );
}

function isLogicalBlock(element: Element): boolean {
  return element.matches(semanticBlockSelector) || hasLogicalDisplay(element);
}

function hasLogicalDisplay(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  return (
    view !== null && logicalDisplays.has(view.getComputedStyle(element).display)
  );
}

function isDocumentBoundary(element: Element): boolean {
  return element.tagName === 'HTML' || element.tagName === 'BODY';
}

function leadingWhitespaceLength(text: string): number {
  let offset = 0;
  while (offset < text.length && /\s/.test(text[offset] ?? '')) {
    offset += 1;
  }
  return offset;
}

function trailingWhitespaceStart(text: string, minimum: number): number {
  let offset = text.length;
  while (offset > minimum && /\s/.test(text[offset - 1] ?? '')) {
    offset -= 1;
  }
  return offset;
}
