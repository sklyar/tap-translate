const englishWordSegmenter = new Intl.Segmenter('en', {
  granularity: 'word',
});

const englishLetterPattern = /^[A-Za-z]$/;
const englishWordPattern = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

export function getEnglishWordAtOffset(
  text: string,
  offset: number,
): string | null {
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

  return segment.segment;
}
