// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockTranslationProvider } from '../src/mock-translation-provider';
import { TranslationController } from '../src/translation-controller';
import { TranslationSheet } from '../src/translation-sheet';
import { createTranslationRequest } from '../src/translation';
import type { DetectionInput, DetectionResult } from '../src/detection';
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
const stylesheetUrl =
  'safari-web-extension://taptranslate-test/translation-sheet.css';

let startTapTranslateContent: typeof import('../src/content').startTapTranslateContent;

beforeAll(async () => {
  const originalDocumentAdd = document.addEventListener.bind(document);
  const originalWindowAdd = window.addEventListener.bind(window);
  const documentAdd = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type !== 'click') {
        originalDocumentAdd(type, listener, options);
      }
    });
  const windowAdd = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type !== 'pagehide') {
        originalWindowAdd(type, listener, options);
      }
    });
  const contentModule = await import('../src/content');
  startTapTranslateContent = contentModule.startTapTranslateContent;
  documentAdd.mockRestore();
  windowAdd.mockRestore();
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

function loadMountedSheetStylesheet(): ShadowRoot {
  const host = document.querySelector('[data-taptranslate-sheet-host]');
  const shadowRoot = host?.shadowRoot;
  const link = shadowRoot?.querySelector(
    'link[rel="stylesheet"][data-taptranslate-stylesheet]',
  );
  if (shadowRoot === null || shadowRoot === undefined) {
    throw new Error('Missing translation sheet shadow root');
  }
  if (!(link instanceof HTMLLinkElement)) {
    throw new Error('Missing translation sheet stylesheet');
  }
  link.dispatchEvent(new Event('load'));
  return shadowRoot;
}

describe('startTapTranslateContent', () => {
  it('detects eligible content inserted after startup', () => {
    const controller = createControllerBoundary();
    const target = document.createElement('p');
    const detect = vi.fn((input: DetectionInput) =>
      input.target === target ? detectionResult : null,
    );
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect,
    });

    target.textContent = 'Turn the dynamically inserted light off.';
    document.body.append(target);
    target.click();

    expect(detect).toHaveBeenCalledOnce();
    expect(controller.translate).toHaveBeenCalledWith(
      createTranslationRequest(detectionResult),
    );
    stop();
  });

  it('dismisses on pagehide while keeping detection active for bfcache', () => {
    const controller = createControllerBoundary();
    const detect = vi.fn(() => detectionResult);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller: controller.boundary,
      sheet: { containsEventPath: () => false },
      detect,
    });
    const pageHide = new Event('pagehide');
    Object.defineProperty(pageHide, 'persisted', { value: true });

    window.dispatchEvent(pageHide);
    createTarget().click();

    expect(controller.dismiss).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledOnce();
    expect(controller.translate).toHaveBeenCalledOnce();
    stop();
  });

  it('removes click and pagehide listeners once during cleanup', () => {
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
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
    window.dispatchEvent(new Event('pagehide'));

    expect(
      documentRemove.mock.calls.filter(([type]) => type === 'click'),
    ).toHaveLength(1);
    expect(
      windowRemove.mock.calls.filter(([type]) => type === 'pagehide'),
    ).toHaveLength(1);
    expect(detect).not.toHaveBeenCalled();
    expect(controller.translate).not.toHaveBeenCalled();
    expect(controller.dismiss).toHaveBeenCalledOnce();
  });

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
    const sheet = new TranslationSheet(
      document,
      {
        onRetry: retryTranslation,
        onDismiss: dismissTranslation,
      },
      stylesheetUrl,
    );
    const controller = new TranslationController(provider, sheet);
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller,
      sheet,
      detect: () => detectionResult,
    });

    createTarget().click();
    const host = document.querySelector('[data-taptranslate-sheet-host]');
    if (!(host instanceof HTMLElement)) {
      throw new Error('Missing translation sheet host');
    }
    expect(host.hidden).toBe(true);
    expect(host.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    const shadowRoot = loadMountedSheetStylesheet();
    expect(host.hidden).toBe(false);
    expect(shadowRoot.textContent).toContain('Переводим');

    await vi.advanceTimersByTimeAsync(50);

    expect(shadowRoot.textContent).toContain('turn off');
    expect(shadowRoot.textContent).toContain('выключить');
    expect(
      shadowRoot.querySelectorAll(
        'link[rel="stylesheet"][data-taptranslate-stylesheet]',
      ),
    ).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();

    function retryTranslation(): void {
      controller.retry();
    }

    function dismissTranslation(): void {
      controller.dismiss();
    }
  });

  it('leaves no resources after repeated mock frontend interaction', async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    const firstTarget = createTarget();
    const replacementTarget = document.createElement('p');
    replacementTarget.textContent = 'Open the window.';
    const outsideTarget = document.createElement('button');
    outsideTarget.textContent = 'Page control';
    document.body.append(replacementTarget, outsideTarget);
    const detect = vi.fn((input: DetectionInput) => {
      if (input.target === firstTarget) {
        return detectionResult;
      }
      if (input.target === replacementTarget) {
        return secondDetectionResult;
      }
      return null;
    });
    const provider = new MockTranslationProvider({
      attempts: [{ type: 'success', result: turnOffResult, delayMs: 5 }],
    });
    const sheet = new TranslationSheet(
      document,
      {
        onRetry: retryTranslation,
        onDismiss: dismissTranslation,
      },
      stylesheetUrl,
    );
    const controller = new TranslationController(provider, sheet);
    const dismiss = vi.spyOn(controller, 'dismiss');
    const stop = startTapTranslateContent({
      documentRoot: document,
      controller,
      sheet,
      detect,
    });

    for (let iteration = 0; iteration < 20; iteration += 1) {
      firstTarget.click();
      expect(
        document.querySelectorAll('[data-taptranslate-sheet-host]'),
      ).toHaveLength(1);
      loadMountedSheetStylesheet();
      await vi.advanceTimersByTimeAsync(5);

      const host = document.querySelector('[data-taptranslate-sheet-host]');
      const expand = host?.shadowRoot?.querySelector(
        '[data-taptranslate-expand]',
      );
      if (!(expand instanceof HTMLElement)) {
        throw new Error('Missing sheet expand control');
      }
      expand.click();

      replacementTarget.click();
      expect(
        document.querySelectorAll('[data-taptranslate-sheet-host]'),
      ).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5);

      outsideTarget.click();
      expect(
        document.querySelectorAll('[data-taptranslate-sheet-host]'),
      ).toHaveLength(0);
    }

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();
    const dismissCount = dismiss.mock.calls.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismiss).toHaveBeenCalledTimes(dismissCount);
    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(
      removeEventListener.mock.calls.filter(([type]) => type === 'keydown')
        .length,
    );

    function retryTranslation(): void {
      controller.retry();
    }

    function dismissTranslation(): void {
      controller.dismiss();
    }
  });
});
