import { describe, expect, it, vi } from 'vitest';

import { MockTranslationProvider } from '../src/mock-translation-provider';
import type { TranslationRequest, TranslationResult } from '../src/translation';

const request: TranslationRequest = {
  context: {
    beforeBlocks: [],
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

const turnOffResult: TranslationResult = {
  expression: 'turn off',
  translation: 'выключить',
  partOfSpeech: 'phrasal verb',
  explanation: 'Здесь означает выключить свет.',
};

const switchOffResult: TranslationResult = {
  expression: 'switch off',
  translation: 'выключить',
  partOfSpeech: 'phrasal verb',
  explanation: 'Альтернативное выражение для выключения.',
};

describe('MockTranslationProvider immediate attempts', () => {
  it('returns a configured success without using the network', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'success', result: turnOffResult }],
    });

    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('rejects a configured failure', async () => {
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'failure', message: 'Mock provider unavailable.' }],
    });

    await expect(provider.translate(request)).rejects.toThrow(
      'Mock provider unavailable.',
    );
  });

  it('models retry with a failure followed by success', async () => {
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'failure', message: 'First attempt failed.' },
        { type: 'success', result: turnOffResult },
      ],
    });

    await expect(provider.translate(request)).rejects.toThrow(
      'First attempt failed.',
    );
    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
  });

  it('repeats the final configured attempt', async () => {
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'success', result: turnOffResult },
        { type: 'success', result: switchOffResult },
      ],
    });

    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
  });
});
