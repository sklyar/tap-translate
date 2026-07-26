const englishWordSegmenter = new Intl.Segmenter('en', {
  granularity: 'word',
});

const englishLetterPattern = /^[A-Za-z]$/;
const englishWordPattern = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export function getEnglishWordSpanAtOffset(
  text: string,
  offset: number,
): TextSpan | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    return null;
  }

  const character = text[offset];

  if (character === undefined || !englishLetterPattern.test(character)) {
    return null;
  }

  const segment = englishWordSegmenter.segment(text).containing(offset);

  if (
    segment?.isWordLike !== true ||
    !englishWordPattern.test(segment.segment)
  ) {
    return null;
  }

  return {
    start: segment.index,
    end: segment.index + segment.segment.length,
  };
}

export function getEnglishWordAtOffset(
  text: string,
  offset: number,
): string | null {
  const span = getEnglishWordSpanAtOffset(text, offset);

  return span === null ? null : text.slice(span.start, span.end);
}
