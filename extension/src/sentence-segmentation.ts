import type { TextSpan } from './word-segmentation';

const englishSentenceSegmenter = new Intl.Segmenter('en', {
  granularity: 'sentence',
});

export function getEnglishSentenceSpanAtOffset(
  text: string,
  offset: number,
): TextSpan | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    return null;
  }

  const segment = englishSentenceSegmenter.segment(text).containing(offset);

  if (segment === undefined) {
    return null;
  }

  let start = segment.index;
  let end = start + segment.segment.length;

  while (start < end && isWhitespace(text[start])) {
    start += 1;
  }

  while (end > start && isWhitespace(text[end - 1])) {
    end -= 1;
  }

  if (start === end || offset < start || offset >= end) {
    return null;
  }

  return { start, end };
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}
