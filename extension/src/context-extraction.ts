import { getEnglishSentenceSpanAtOffset } from './sentence-segmentation';
import {
  buildTextSnapshot,
  findFocusBlock,
  findReadingRegion,
} from './text-snapshot';
import type { TextHit } from './hit-testing';
import { getEnglishWordSpanAtOffset, type TextSpan } from './word-segmentation';

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

const defaultLimits: ContextLimits = {
  focusBlockCharacters: 4_000,
  neighborBlockCharacters: 2_000,
};

export function extractTextContext(
  hit: TextHit,
  focusBlock: Element,
  limits: ContextLimits = defaultLimits,
): DetectionContext | null {
  if (!areValidLimits(limits)) {
    return null;
  }

  const snapshot = buildTextSnapshot(focusBlock, {
    textNode: hit.textNode,
    offset: hit.characterOffset,
  });

  if (snapshot?.sourceOffset === null || snapshot === null) {
    return null;
  }

  const word = getEnglishWordSpanAtOffset(snapshot.text, snapshot.sourceOffset);
  if (word === null) {
    return null;
  }

  const sentence = getEnglishSentenceSpanAtOffset(snapshot.text, word.start);
  if (sentence === null) {
    return null;
  }

  const croppedFocus = cropFocusBlock(
    snapshot.text,
    word,
    sentence,
    limits.focusBlockCharacters,
  );

  if (croppedFocus === null || !isValidFocusBlock(croppedFocus)) {
    return null;
  }

  return {
    beforeBlocks: optionalBlock(
      findNeighborBlock(
        hit.textNode,
        focusBlock,
        'before',
        limits.neighborBlockCharacters,
      ),
    ),
    focusBlock: croppedFocus,
    afterBlocks: optionalBlock(
      findNeighborBlock(
        hit.textNode,
        focusBlock,
        'after',
        limits.neighborBlockCharacters,
      ),
    ),
  };
}

function findNeighborBlock(
  hitTextNode: Text,
  focusBlock: Element,
  direction: 'before' | 'after',
  limit: number,
): ContextBlock | null {
  const focusRegion = findReadingRegion(focusBlock);
  const fallbackParent = focusRegion === null ? focusBlock.parentElement : null;
  const traversalRoot = focusRegion ?? fallbackParent;

  if (
    traversalRoot === null ||
    isDocumentBoundary(traversalRoot) ||
    !traversalRoot.contains(hitTextNode)
  ) {
    return null;
  }

  const walker = focusBlock.ownerDocument.createTreeWalker(
    traversalRoot,
    NodeFilter.SHOW_TEXT,
  );
  walker.currentNode = hitTextNode;
  const visitedBlocks = new Set<Element>();

  for (;;) {
    const node =
      direction === 'before' ? walker.previousNode() : walker.nextNode();
    if (node === null) {
      return null;
    }

    if (!(node instanceof Text) || focusBlock.contains(node)) {
      continue;
    }

    const candidate = findFocusBlock(node);
    if (
      candidate === null ||
      candidate === focusBlock ||
      visitedBlocks.has(candidate)
    ) {
      continue;
    }
    visitedBlocks.add(candidate);

    if (!hasSameContextOwner(candidate, focusRegion, fallbackParent)) {
      continue;
    }

    const snapshot = buildTextSnapshot(candidate, null);
    if (snapshot === null) {
      continue;
    }

    const block = cropNeighborBlock(snapshot.text, direction, limit);
    if (block !== null) {
      return block;
    }
  }
}

function hasSameContextOwner(
  candidate: Element,
  focusRegion: Element | null,
  fallbackParent: Element | null,
): boolean {
  const candidateRegion = findReadingRegion(candidate);

  return focusRegion === null
    ? candidateRegion === null && candidate.parentElement === fallbackParent
    : candidateRegion === focusRegion;
}

function cropNeighborBlock(
  text: string,
  direction: 'before' | 'after',
  limit: number,
): ContextBlock | null {
  let start = direction === 'before' ? Math.max(0, text.length - limit) : 0;
  let end = direction === 'after' ? Math.min(text.length, limit) : text.length;

  start = safeStartBoundary(text, start);
  end = safeEndBoundary(text, end);

  while (start < end && isWhitespace(text[start])) {
    start += 1;
  }
  while (end > start && isWhitespace(text[end - 1])) {
    end -= 1;
  }

  if (start === end) {
    return null;
  }

  return {
    text: text.slice(start, end),
    truncatedBefore: start > 0,
    truncatedAfter: end < text.length,
  };
}

function optionalBlock(block: ContextBlock | null): readonly ContextBlock[] {
  return block === null ? [] : [block];
}

function cropFocusBlock(
  text: string,
  word: TextSpan,
  sentence: TextSpan,
  limit: number,
): FocusContextBlock | null {
  if (!isValidNestedSpans(text.length, word, sentence)) {
    return null;
  }

  const sentenceLength = sentence.end - sentence.start;
  if (sentenceLength > limit) {
    return null;
  }

  let start = 0;
  let end = text.length;

  if (text.length > limit) {
    const remaining = limit - sentenceLength;
    const beforeBudget = Math.floor(remaining / 2);
    const afterBudget = remaining - beforeBudget;
    start = Math.max(0, sentence.start - beforeBudget);
    end = Math.min(text.length, sentence.end + afterBudget);

    const missing = limit - (end - start);
    if (missing > 0 && start === 0) {
      end = Math.min(text.length, end + missing);
    } else if (missing > 0 && end === text.length) {
      start = Math.max(0, start - missing);
    }
  }

  start = safeStartBoundary(text, start);
  end = safeEndBoundary(text, end);

  while (start < sentence.start && isWhitespace(text[start])) {
    start += 1;
  }
  while (end > sentence.end && isWhitespace(text[end - 1])) {
    end -= 1;
  }

  const focus: FocusContextBlock = {
    text: text.slice(start, end),
    word: rebaseSpan(word, start),
    sentence: rebaseSpan(sentence, start),
    truncatedBefore: start > 0,
    truncatedAfter: end < text.length,
  };

  return focus.text.length <= limit ? focus : null;
}

function safeStartBoundary(text: string, start: number): number {
  return isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start;
}

function safeEndBoundary(text: string, end: number): number {
  return isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isDocumentBoundary(element: Element): boolean {
  return element.tagName === 'HTML' || element.tagName === 'BODY';
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function rebaseSpan(span: TextSpan, start: number): TextSpan {
  return { start: span.start - start, end: span.end - start };
}

function areValidLimits(limits: ContextLimits): boolean {
  return (
    Number.isInteger(limits.focusBlockCharacters) &&
    limits.focusBlockCharacters > 0 &&
    Number.isInteger(limits.neighborBlockCharacters) &&
    limits.neighborBlockCharacters > 0
  );
}

function isValidFocusBlock(block: FocusContextBlock): boolean {
  return isValidNestedSpans(block.text.length, block.word, block.sentence);
}

function isValidNestedSpans(
  textLength: number,
  word: TextSpan,
  sentence: TextSpan,
): boolean {
  return (
    isValidSpan(word, textLength) &&
    isValidSpan(sentence, textLength) &&
    sentence.start <= word.start &&
    word.end <= sentence.end
  );
}

function isValidSpan(span: TextSpan, textLength: number): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.start < span.end &&
    span.end <= textLength
  );
}
