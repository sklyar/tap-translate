// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockTranslationProvider } from '../src/mock-translation-provider';
import { TranslationController } from '../src/translation-controller';
import { TranslationSheet } from '../src/translation-sheet';
import { createTranslationRequest } from '../src/translation';
import type { DetectionResult } from '../src/detection';
import type { TranslationRequest, TranslationResult } from '../src/translation';

const detectionResult: DetectionResult = {
  anchorRect: { x: 10, y: 20, width: 8, height: 16 },
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

const secondDetectionResult: DetectionResult = {
  anchorRect: { x: 40, y: 60, width: 9, height: 16 },
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

let startTapTranslateContent: typeof import('../src/content').startTapTranslateContent;

beforeAll(async () => {
  const originalAddEventListener = document.addEventListener.bind(document);
  const addEventListener = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type !== 'click') {
        originalAddEventListener(type, listener, options);
      }
    });
  const contentModule = await import('../src/content');
  startTapTranslateContent = contentModule.startTapTranslateContent;
  addEventListener.mockRestore();
});

afterEach(() => {
  document
    .querySelectorAll('[data-taptranslate-sheet-host]')
    .forEach((host) => {
      host.remove();
    });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createControllerBoundary(): {
  readonly boundary: {
    readonly translate: (request: TranslationRequest) => void;
    readonly dismiss: () => void;
  };
  readonly translate: ReturnType<
    typeof vi.fn<(request: TranslationRequest) => void>
  >;
  readonly dismiss: ReturnType<typeof vi.fn<() => void>>;
} {
  const translate = vi.fn<(request: TranslationRequest) => void>();
  const dismiss = vi.fn<() => void>();
  return {
    boundary: {
      translate: (request): void => {
        translate(request);
      },
      dismiss: (): void => {
        dismiss();
      },
    },
    translate,
    dismiss,
  };
}

function createTarget(): HTMLElement {
  const target = document.createElement('p');
  target.textContent = 'Turn the light off.';
  document.body.append(target);
  return target;
}

describe('startTapTranslateContent', () => {
  it('converts eligible detection and preserves the page click', () => {
    const controller = createControllerBoundary();
    const detect = vi.fn(() => detectionResult);
    const containsEventPath = vi.fn(() => false);
    const pageClick = vi.fn<() => void>();
    document.addEventListener('click', pageClick);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath },
      detect,
    });
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 34,
    });

    createTarget().dispatchEvent(event);

    expect(controller.translate).toHaveBeenCalledWith(
      createTranslationRequest(detectionResult),
    );
    expect(detect).toHaveBeenCalledWith(
      expect.objectContaining({
        point: { clientX: 12, clientY: 34 },
      }),
      document,
    );
    expect(pageClick).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    stop();
    document.removeEventListener('click', pageClick);
  });

  it('sends a second eligible click as a replacement request', () => {
    const controller = createControllerBoundary();
    const detect = vi
      .fn()
      .mockReturnValueOnce(detectionResult)
      .mockReturnValueOnce(secondDetectionResult);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect,
    });
    const target = createTarget();

    target.click();
    target.click();

    expect(controller.translate).toHaveBeenNthCalledWith(
      1,
      createTranslationRequest(detectionResult),
    );
    expect(controller.translate).toHaveBeenNthCalledWith(
      2,
      createTranslationRequest(secondDetectionResult),
    );
    stop();
  });

  it('dismisses for an ineligible external click without consuming it', () => {
    const controller = createControllerBoundary();
    const pageClick = vi.fn<() => void>();
    document.addEventListener('click', pageClick);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect: () => null,
    });
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });

    createTarget().dispatchEvent(event);

    expect(controller.dismiss).toHaveBeenCalledOnce();
    expect(pageClick).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    stop();
    document.removeEventListener('click', pageClick);
  });

  it('ignores a click whose composed path belongs to the sheet', () => {
    const controller = createControllerBoundary();
    const detect = vi.fn(() => detectionResult);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => true },
      detect,
    });

    createTarget().click();

    expect(detect).not.toHaveBeenCalled();
    expect(controller.translate).not.toHaveBeenCalled();
    expect(controller.dismiss).not.toHaveBeenCalled();
    stop();
  });

  it('logs only a fixed message for an unexpected interaction failure', () => {
    const controller = createControllerBoundary();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected privacy-safe boundary log.
    });
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect: () => {
        throw new Error('Private page context');
      },
    });

    createTarget().click();

    expect(consoleError).toHaveBeenCalledWith(
      '[TapTranslate] Unexpected interaction failure.',
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    stop();
  });

  it('returns an idempotent cleanup that removes its listener', () => {
    const controller = createControllerBoundary();
    const detect = vi.fn(() => detectionResult);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect,
    });

    stop();
    stop();
    createTarget().click();

    expect(detect).not.toHaveBeenCalled();
    expect(controller.dismiss).toHaveBeenCalledOnce();
  });

  it('wires loading to delayed mock success without network access', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'success', result: turnOffResult, delayMs: 50 }],
    });
    const sheet = new TranslationSheet(document, {
      onRetry: retryTranslation,
      onDismiss: dismissTranslation,
    });
    const controller = new TranslationController(provider, sheet);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller,
      sheet,
      detect: () => detectionResult,
    });

    createTarget().click();
    const host = document.querySelector('[data-taptranslate-sheet-host]');
    expect(host?.shadowRoot?.textContent).toContain('Переводим');

    await vi.advanceTimersByTimeAsync(50);

    expect(host?.shadowRoot?.textContent).toContain('turn off');
    expect(host?.shadowRoot?.textContent).toContain('выключить');
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();

    function retryTranslation(): void {
      controller.retry();
    }

    function dismissTranslation(): void {
      controller.dismiss();
    }
  });
});
