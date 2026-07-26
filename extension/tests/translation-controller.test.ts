import { describe, expect, it, vi } from 'vitest';

import {
  TranslationController,
  type TranslationView,
  type TranslationViewState,
} from '../src/translation-controller';
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '../src/translation';

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

const secondRequest: TranslationRequest = {
  context: {
    beforeBlocks: [],
    focusBlock: {
      text: 'Open the window.',
      word: { start: 0, end: 4 },
      sentence: { start: 0, end: 16 },
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

const openResult: TranslationResult = {
  expression: 'open',
  translation: 'открыть',
  partOfSpeech: 'verb',
  explanation: 'Здесь означает открыть окно.',
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value): void => resolvePromise?.(value),
    reject: (reason): void => rejectPromise?.(reason),
  };
}

function createView(): {
  readonly boundary: TranslationView;
  readonly render: ReturnType<
    typeof vi.fn<(state: TranslationViewState) => void>
  >;
  readonly destroy: ReturnType<typeof vi.fn<() => void>>;
} {
  const render = vi.fn<(state: TranslationViewState) => void>();
  const destroy = vi.fn<() => void>();

  return {
    boundary: {
      render: (state): void => {
        render(state);
      },
      destroy: (): void => {
        destroy();
      },
    },
    render,
    destroy,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TranslationController', () => {
  it('renders loading followed by success', async () => {
    const translation = createDeferred<TranslationResult>();
    const provider: TranslationProvider = {
      translate: vi.fn(() => translation.promise),
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);

    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'loading',
      request,
    });
    translation.resolve(turnOffResult);
    await flushPromises();
    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'success',
      request,
      result: turnOffResult,
    });
  });

  it('renders a neutral error state without exposing the failure', async () => {
    const failure = new Error('Private provider details');
    const provider: TranslationProvider = {
      translate: vi.fn(() => Promise.reject(failure)),
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    await flushPromises();

    expect(view.render).toHaveBeenLastCalledWith({ kind: 'error', request });
    expect(view.render.mock.calls.flat()).not.toContain(failure);
  });

  it('retries the identical request with a fresh signal', async () => {
    const translate = vi
      .fn<TranslationProvider['translate']>()
      .mockResolvedValue(turnOffResult);
    const provider: TranslationProvider = {
      translate,
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    await flushPromises();
    const firstSignal = translate.mock.calls[0]?.[1]?.signal;

    controller.retry();
    const secondCall = translate.mock.calls[1];

    expect(firstSignal?.aborted).toBe(true);
    expect(secondCall?.[0]).toBe(request);
    expect(secondCall?.[1]?.signal).not.toBe(firstSignal);
  });

  it('aborts replacement and ignores its stale success', async () => {
    const first = createDeferred<TranslationResult>();
    const second = createDeferred<TranslationResult>();
    const translate = vi
      .fn<TranslationProvider['translate']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const provider: TranslationProvider = {
      translate,
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    const firstSignal = translate.mock.calls[0]?.[1]?.signal;
    controller.translate(secondRequest);

    expect(firstSignal?.aborted).toBe(true);
    first.resolve(turnOffResult);
    await flushPromises();
    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'loading',
      request: secondRequest,
    });

    second.resolve(openResult);
    await flushPromises();
    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'success',
      request: secondRequest,
      result: openResult,
    });
  });

  it('ignores a stale failure from a provider that ignores cancellation', async () => {
    const first = createDeferred<TranslationResult>();
    const second = createDeferred<TranslationResult>();
    const translate = vi
      .fn<TranslationProvider['translate']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const provider: TranslationProvider = {
      translate,
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    controller.translate(secondRequest);
    first.reject(new Error('Stale private failure'));
    await flushPromises();

    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'loading',
      request: secondRequest,
    });
    second.resolve(openResult);
    await flushPromises();
    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'success',
      request: secondRequest,
      result: openResult,
    });
  });

  it('cancels and unmounts on dismissal without accepting later completion', async () => {
    const translation = createDeferred<TranslationResult>();
    const translate = vi
      .fn<TranslationProvider['translate']>()
      .mockReturnValue(translation.promise);
    const provider: TranslationProvider = {
      translate,
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    const signal = translate.mock.calls[0]?.[1]?.signal;
    controller.dismiss();
    controller.dismiss();
    translation.resolve(turnOffResult);
    await flushPromises();

    expect(signal?.aborted).toBe(true);
    expect(view.destroy).toHaveBeenCalledTimes(2);
    expect(view.render).toHaveBeenCalledTimes(1);
  });

  it('keeps AbortError cancellation silent', async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(() =>
        Promise.reject(new DOMException('Cancelled', 'AbortError')),
      ),
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    controller.translate(request);
    await flushPromises();

    expect(view.render).toHaveBeenCalledTimes(1);
    expect(view.render).toHaveBeenLastCalledWith({
      kind: 'loading',
      request,
    });
  });

  it('contains synchronous provider failures', () => {
    const provider: TranslationProvider = {
      translate: vi.fn(() => {
        throw new Error('Synchronous private failure');
      }),
    };
    const view = createView();
    const controller = new TranslationController(provider, view.boundary);

    expect(() => {
      controller.translate(request);
    }).not.toThrow();
    expect(view.render).toHaveBeenLastCalledWith({ kind: 'error', request });
  });

  it('contains view failures and cancels the provider call', () => {
    const translate = vi.fn(() => Promise.resolve(turnOffResult));
    const provider: TranslationProvider = {
      translate,
    };
    const view = createView();
    view.render.mockImplementationOnce(() => {
      throw new Error('Broken view');
    });
    const controller = new TranslationController(provider, view.boundary);

    expect(() => {
      controller.translate(request);
    }).not.toThrow();
    expect(translate).not.toHaveBeenCalled();
    expect(view.destroy).toHaveBeenCalledOnce();
  });
});
