import { getEnglishSentenceSpanAtOffset } from './sentence-segmentation';
import { buildTextSnapshot } from './text-snapshot';
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

  if (snapshot === null || snapshot.sourceOffset === null) {
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
    beforeBlocks: [],
    focusBlock: croppedFocus,
    afterBlocks: [],
  };
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
