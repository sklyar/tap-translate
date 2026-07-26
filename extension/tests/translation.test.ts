import { describe, expect, it } from 'vitest';

import type { DetectionResult } from '../src/detection';
import {
  createTranslationRequest,
  type TranslationResult,
} from '../src/translation';

const detectionResult: DetectionResult = {
  anchorRect: { x: 10, y: 20, width: 8, height: 16 },
  context: {
    beforeBlocks: [
      {
        text: 'The room was getting dark.',
        truncatedBefore: false,
        truncatedAfter: false,
      },
    ],
    focusBlock: {
      text: 'Turn the light off.',
      word: { start: 0, end: 4 },
      sentence: { start: 0, end: 19 },
      truncatedBefore: false,
      truncatedAfter: false,
    },
    afterBlocks: [],
  },
};

describe('createTranslationRequest', () => {
  it('preserves translation context and excludes viewport geometry', () => {
    const request = createTranslationRequest(detectionResult);

    expect(request).toEqual({ context: detectionResult.context });
    expect(request).not.toHaveProperty('anchorRect');
    expect(JSON.parse(JSON.stringify(request)) as unknown).toEqual(request);
  });

  it('keeps the selected word and sentence derivable from spans', () => {
    const { text, word, sentence } =
      createTranslationRequest(detectionResult).context.focusBlock;

    expect(text.slice(word.start, word.end)).toBe('Turn');
    expect(text.slice(sentence.start, sentence.end)).toBe(
      'Turn the light off.',
    );
  });
});

describe('TranslationResult', () => {
  it('allows the contextual expression to differ from the clicked word', () => {
    const result: TranslationResult = {
      expression: 'turn off',
      translation: 'выключить',
      partOfSpeech: 'phrasal verb',
      explanation: 'Здесь означает выключить свет.',
    };

    expect(result.expression).toBe('turn off');
    expect(result.translation).toBe('выключить');
  });
});
