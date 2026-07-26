import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockTranslationProvider } from '../src/mock-translation-provider';
import type { TranslationRequest, TranslationResult } from '../src/translation';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

describe('MockTranslationProvider timing', () => {
  it('settles a successful attempt only after its configured delay', async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'success', result: turnOffResult, delayMs: 500 }],
    });
    let settled = false;
    const translation = provider.translate(request).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(translation).resolves.toBe(turnOffResult);
  });

  it('rejects a failure only after its configured delay', async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'failure', message: 'Delayed failure.', delayMs: 250 },
      ],
    });
    let settled = false;
    const translation = provider.translate(request);
    void translation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(translation).rejects.toThrow('Delayed failure.');
  });

  it('assigns concurrent calls by invocation order', async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'success', result: turnOffResult, delayMs: 100 },
        { type: 'success', result: switchOffResult },
      ],
    });

    const first = provider.translate(request);
    const second = provider.translate(request);

    await expect(second).resolves.toBe(switchOffResult);
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(turnOffResult);
  });
});

describe('MockTranslationProvider cancellation', () => {
  it('rejects a pre-aborted call without consuming an attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'success', result: turnOffResult },
        { type: 'success', result: switchOffResult },
      ],
    });

    await expect(
      provider.translate(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
  });

  it('cancels a delayed attempt and advances a later retry', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(
      controller.signal,
      'removeEventListener',
    );
    const provider = new MockTranslationProvider({
      attempts: [
        { type: 'success', result: turnOffResult, delayMs: 500 },
        { type: 'success', result: switchOffResult },
      ],
    });

    const translation = provider.translate(request, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(translation).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
    );
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
  });

  it('ignores abort after a delayed attempt has settled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'success', result: turnOffResult, delayMs: 10 }],
    });

    const translation = provider.translate(request, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(translation).resolves.toBe(turnOffResult);

    controller.abort();
    await expect(translation).resolves.toBe(turnOffResult);
    expect(vi.getTimerCount()).toBe(0);
  });
});
