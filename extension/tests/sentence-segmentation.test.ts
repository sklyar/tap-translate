import { describe, expect, it } from 'vitest';

import { getEnglishSentenceSpanAtOffset } from '../src/sentence-segmentation';

describe('getEnglishSentenceSpanAtOffset', () => {
  it.each([
    {
      name: 'first sentence',
      text: 'First sentence. Second sentence!',
      offset: 2,
      expected: { start: 0, end: 15 },
    },
    {
      name: 'second sentence without leading whitespace',
      text: 'First sentence. Second sentence!',
      offset: 17,
      expected: { start: 16, end: 32 },
    },
    {
      name: 'sentence after an explicit newline',
      text: 'One.\nTwo.',
      offset: 6,
      expected: { start: 5, end: 9 },
    },
    {
      name: 'block without terminal punctuation',
      text: 'Turn the light off',
      offset: 5,
      expected: { start: 0, end: 18 },
    },
  ])('returns the $name', ({ text, offset, expected }) => {
    expect(getEnglishSentenceSpanAtOffset(text, offset)).toEqual(expected);
  });

  it.each([
    { text: '', offset: 0 },
    { text: 'Sentence.', offset: -1 },
    { text: 'Sentence.', offset: 9 },
    { text: '   ', offset: 1 },
  ])('returns null for invalid or whitespace input', ({ text, offset }) => {
    expect(getEnglishSentenceSpanAtOffset(text, offset)).toBeNull();
  });
});
