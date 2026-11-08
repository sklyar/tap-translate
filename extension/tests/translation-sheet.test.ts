// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslationSheet } from '../src/translation-sheet';
import type { TranslationViewState } from '../src/translation-controller';
import type { TranslationRequest, TranslationResult } from '../src/translation';

const translationSheetStyles = readFileSync(
  'public/translation-sheet.css',
  'utf8',
);
const stylesheetUrl =
  'safari-web-extension://taptranslate-test/translation-sheet.css';

const request: TranslationRequest = {
  context: {
    beforeBlocks: [],
    focusBlock: {
      text: 'Before. Turn the light off. After.',
      word: { start: 8, end: 12 },
      sentence: { start: 8, end: 27 },
      truncatedBefore: false,
      truncatedAfter: false,
    },
    afterBlocks: [],
  },
};

const result: TranslationResult = {
  expression: 'turn off',
  translation: 'выключить',
  partOfSpeech: 'phrasal verb',
  explanation: 'Здесь означает выключить свет.',
};

const loadingState: TranslationViewState = { kind: 'loading', request };
const successState: TranslationViewState = {
  kind: 'success',
  request,
  result,
};
const errorState: TranslationViewState = { kind: 'error', request };

afterEach(() => {
  document
    .querySelectorAll('[data-taptranslate-sheet-host]')
    .forEach((host) => {
      host.remove();
    });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createSheet(): {
  readonly sheet: TranslationSheet;
  readonly retry: ReturnType<typeof vi.fn<() => void>>;
  readonly dismiss: ReturnType<typeof vi.fn<() => void>>;
} {
  const retry = vi.fn<() => void>();
  const dismiss = vi.fn<() => void>();
  const sheet = new TranslationSheet(
    document,
    {
      onRetry: (): void => {
        retry();
      },
      onDismiss: (): void => {
        dismiss();
      },
    },
    stylesheetUrl,
  );
  return { sheet, retry, dismiss };
}

function requiredHost(): HTMLElement {
  const host = document.querySelector('[data-taptranslate-sheet-host]');
  if (!(host instanceof HTMLElement)) {
    throw new Error('Missing translation sheet host');
  }
  return host;
}

function requiredShadowRoot(): ShadowRoot {
  const shadowRoot = requiredHost().shadowRoot;
  if (shadowRoot === null) {
    throw new Error('Missing open shadow root');
  }
  return shadowRoot;
}

function requiredElement(selector: string): HTMLElement {
  const element = requiredShadowRoot().querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing sheet element: ${selector}`);
  }
  return element;
}

function requiredStylesheet(): HTMLLinkElement {
  const link = requiredShadowRoot().querySelector(
    'link[rel="stylesheet"][data-taptranslate-stylesheet]',
  );
  if (!(link instanceof HTMLLinkElement)) {
    throw new Error('Missing translation sheet stylesheet');
  }
  return link;
}

function loadStylesheet(): void {
  requiredStylesheet().dispatchEvent(new Event('load'));
}

function renderReady(
  sheet: TranslationSheet,
  state: TranslationViewState,
): void {
  sheet.render(state);
  loadStylesheet();
}

describe('TranslationSheet rendering', () => {
  it.each(['browser', 'chrome'] as const)(
    'resolves the packaged stylesheet through the %s runtime',
    (runtimeName) => {
      const getURL = vi.fn<(path: string) => string>(() => stylesheetUrl);
      vi.stubGlobal(runtimeName, { runtime: { getURL } });
      const sheet = new TranslationSheet(document, {
        onRetry: vi.fn(),
        onDismiss: vi.fn(),
      });

      sheet.render(loadingState);

      expect(getURL).toHaveBeenCalledWith('translation-sheet.css');
      expect(requiredStylesheet().href).toBe(stylesheetUrl);
    },
  );

  it('fails closed when the extension runtime cannot resolve the stylesheet', () => {
    const getURL = vi.fn<() => string>(() => {
      throw new Error('Unavailable extension runtime');
    });
    vi.stubGlobal('browser', { runtime: { getURL } });
    const sheet = new TranslationSheet(document, {
      onRetry: vi.fn(),
      onDismiss: vi.fn(),
    });

    expect(() => {
      sheet.render(loadingState);
    }).not.toThrow();
    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();
  });

  it('mounts one open shadow root and reuses it across state updates', () => {
    const { sheet } = createSheet();

    sheet.render(loadingState);
    const host = requiredHost();
    const shadowRoot = requiredShadowRoot();
    const stylesheet = requiredStylesheet();

    expect(host.hidden).toBe(true);
    expect(stylesheet.href).toBe(stylesheetUrl);
    expect(shadowRoot.querySelector('style')).toBeNull();
    expect(shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();

    sheet.render(successState);
    loadStylesheet();

    expect(host.hidden).toBe(false);
    expect(shadowRoot.textContent).toContain('turn off');
    expect(shadowRoot.textContent).not.toContain('Переводим выражение…');
    expect(
      shadowRoot.querySelector('[role="dialog"]')?.hasAttribute('aria-modal'),
    ).toBe(false);

    expect(requiredHost()).toBe(host);
    expect(requiredShadowRoot()).toBe(shadowRoot);
    expect(
      document.querySelectorAll('[data-taptranslate-sheet-host]'),
    ).toHaveLength(1);
    expect(requiredStylesheet()).toBe(stylesheet);
  });

  it('fails closed on stylesheet error and retries only for a new request', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // A stylesheet failure must remain silent and privacy-safe.
    });
    const { sheet, retry, dismiss } = createSheet();

    sheet.render(loadingState);
    const failedStylesheet = requiredStylesheet();
    expect(requiredShadowRoot().querySelector('[role="dialog"]')).toBeNull();

    failedStylesheet.dispatchEvent(new Event('error'));

    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(1);

    sheet.render(successState);
    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();

    const nextRequest: TranslationRequest = { context: request.context };
    sheet.render({ kind: 'loading', request: nextRequest });
    expect(requiredStylesheet()).not.toBe(failedStylesheet);
    expect(requiredShadowRoot().querySelector('[role="dialog"]')).toBeNull();
    loadStylesheet();

    expect(requiredShadowRoot().textContent).toContain('Переводим');
    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(2);
    expect(retry).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('renders the contextual success hierarchy with language metadata', () => {
    const { sheet } = createSheet();

    renderReady(sheet, successState);

    const shadowRoot = requiredShadowRoot();
    expect(shadowRoot.textContent).toContain('turn off');
    expect(shadowRoot.textContent).toContain('phrasal verb');
    expect(shadowRoot.textContent).toContain('выключить');
    expect(shadowRoot.textContent).toContain('Здесь означает выключить свет.');
    expect(
      requiredElement('[data-taptranslate-expression]').getAttribute('lang'),
    ).toBe('en');
    expect(
      requiredElement('[data-taptranslate-translation]').getAttribute('lang'),
    ).toBe('ru');
    expect(
      requiredElement('[data-taptranslate-explanation]').getAttribute('lang'),
    ).toBe('ru');
  });

  it('renders provider markup as literal text', () => {
    const { sheet } = createSheet();
    const unsafeResult: TranslationResult = {
      ...result,
      expression: '<img data-injected src=x>',
      explanation: '<script data-injected>bad()</script>',
    };

    renderReady(sheet, { kind: 'success', request, result: unsafeResult });

    const shadowRoot = requiredShadowRoot();
    expect(shadowRoot.querySelector('[data-injected]')).toBeNull();
    expect(shadowRoot.textContent).toContain('<img data-injected src=x>');
    expect(shadowRoot.textContent).toContain(
      '<script data-injected>bad()</script>',
    );
  });

  it('keeps long markup-shaped provider strings as text', () => {
    const { sheet } = createSheet();
    const longExpression = `<img data-injected src=x> ${'turn off '.repeat(80)}`;
    const longTranslation = `<b data-injected>выключить</b> ${'перевод '.repeat(80)}`;
    const longPartOfSpeech = `<i data-injected>phrasal verb</i> ${'grammar '.repeat(40)}`;
    const longExplanation = `<script data-injected>bad()</script> ${'контекстное объяснение '.repeat(80)}`;

    sheet.render({
      kind: 'success',
      request,
      result: {
        expression: longExpression,
        translation: longTranslation,
        partOfSpeech: longPartOfSpeech,
        explanation: longExplanation,
      },
    });
    loadStylesheet();

    const shadowRoot = requiredShadowRoot();
    expect(shadowRoot.querySelector('[data-injected]')).toBeNull();
    expect(requiredElement('[data-taptranslate-expression]').textContent).toBe(
      longExpression,
    );
    expect(requiredElement('[data-taptranslate-translation]').textContent).toBe(
      longTranslation,
    );
    expect(requiredElement('.part-of-speech').textContent).toBe(
      longPartOfSpeech,
    );
    expect(requiredElement('[data-taptranslate-explanation]').textContent).toBe(
      longExplanation,
    );
    expect(shadowRoot.querySelector('style')).toBeNull();
    expect(shadowRoot.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(
      1,
    );
  });

  it('toggles expanded mode and highlights only the clicked source word', () => {
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    const handle = requiredElement('[data-taptranslate-expand]');

    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(handle.getAttribute('aria-label')).toBe('Развернуть перевод');
    expect(
      requiredElement('[data-taptranslate-sheet]').getAttribute(
        'data-expanded',
      ),
    ).toBe('false');
    expect(
      requiredShadowRoot().querySelector('[data-taptranslate-sentence]'),
    ).toBeNull();

    handle.click();

    const expandedHandle = requiredElement('[data-taptranslate-expand]');
    const sentence = requiredElement('[data-taptranslate-sentence]');
    const mark = sentence.querySelector('mark');
    expect(expandedHandle.getAttribute('aria-expanded')).toBe('true');
    expect(expandedHandle.getAttribute('aria-label')).toBe('Свернуть перевод');
    expect(sentence.textContent).toBe('Turn the light off.');
    expect(mark?.textContent).toBe('Turn');
    expect(mark?.getAttribute('lang')).toBe('en');

    sheet.render(loadingState);
    expect(
      requiredElement('[data-taptranslate-sheet]').getAttribute(
        'data-expanded',
      ),
    ).toBe('true');
  });

  it('falls back to an unmarked sentence when spans are invalid', () => {
    const { sheet } = createSheet();
    const invalidRequest: TranslationRequest = {
      context: {
        ...request.context,
        focusBlock: {
          ...request.context.focusBlock,
          word: { start: 0, end: 200 },
        },
      },
    };

    renderReady(sheet, {
      kind: 'success',
      request: invalidRequest,
      result,
    });
    requiredElement('[data-taptranslate-expand]').click();

    const sentence = requiredElement('[data-taptranslate-sentence]');
    expect(sentence.textContent).toBe('Turn the light off.');
    expect(sentence.querySelector('mark')).toBeNull();
  });
});

describe('TranslationSheet controls and lifecycle', () => {
  it('remounts a detached host while preserving state and expansion', () => {
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();
    const staleHost = requiredHost();
    const staleStylesheet = requiredStylesheet();

    staleHost.remove();
    sheet.render(successState);

    expect(requiredHost()).not.toBe(staleHost);
    expect(
      document.querySelectorAll('[data-taptranslate-sheet-host]'),
    ).toHaveLength(1);
    expect(requiredShadowRoot().querySelector('[role="dialog"]')).toBeNull();
    staleStylesheet.dispatchEvent(new Event('load'));
    expect(requiredShadowRoot().querySelector('[role="dialog"]')).toBeNull();
    loadStylesheet();
    expect(
      requiredElement('[data-taptranslate-sheet]').getAttribute(
        'data-expanded',
      ),
    ).toBe('true');
    expect(requiredShadowRoot().textContent).toContain('turn off');
  });

  it('replaces the sheet keydown listener instead of duplicating it', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const { sheet, dismiss } = createSheet();

    renderReady(sheet, successState);
    requiredHost().remove();
    sheet.render(successState);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(dismiss).toHaveBeenCalledOnce();
    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(2);
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(1);
  });

  it('does not restore or recapture page focus while remounting', () => {
    const original = document.createElement('button');
    const later = document.createElement('button');
    document.body.append(original, later);
    original.focus();
    const { sheet } = createSheet();
    renderReady(sheet, successState);

    requiredHost().remove();
    later.focus();
    sheet.render(successState);

    expect(document.activeElement).toBe(later);
    loadStylesheet();
    requiredElement('[data-taptranslate-close]').focus();
    sheet.destroy();
    expect(document.activeElement).toBe(original);
  });

  it('leaves no host or keydown listener after repeated recovery', () => {
    const { sheet, dismiss } = createSheet();

    for (let iteration = 0; iteration < 20; iteration += 1) {
      renderReady(sheet, successState);
      requiredHost().remove();
      sheet.render(successState);
      loadStylesheet();
      expect(
        document.querySelectorAll('[data-taptranslate-sheet-host]'),
      ).toHaveLength(1);
    }

    sheet.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('announces neutral loading and error states and retries', () => {
    const { sheet, retry } = createSheet();

    renderReady(sheet, loadingState);
    expect(requiredElement('[data-taptranslate-status]').textContent).toBe(
      'Переводим выражение…',
    );

    sheet.render(errorState);
    expect(requiredElement('[data-taptranslate-status]').textContent).toBe(
      'Не удалось получить перевод.',
    );
    expect(requiredShadowRoot().textContent).not.toContain('Private');
    requiredElement('[data-taptranslate-retry]').click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('dismisses from the close button', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);

    const close = requiredElement('[data-taptranslate-close]');
    expect(close.getAttribute('aria-label')).toBe('Закрыть перевод');
    close.click();

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape without consuming the document event', () => {
    const { sheet, dismiss } = createSheet();
    const observer = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener('keydown', observer);
    renderReady(sheet, successState);
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(dismiss).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener('keydown', observer);
  });

  it('recognizes its current host in a composed event path', () => {
    const { sheet } = createSheet();

    expect(sheet.containsEventPath([])).toBe(false);
    renderReady(sheet, loadingState);
    const host = requiredHost();
    expect(sheet.containsEventPath([document, host])).toBe(true);
    expect(sheet.containsEventPath([document.body, document])).toBe(false);

    sheet.destroy();
    expect(sheet.containsEventPath([host])).toBe(false);
  });

  it('destroys idempotently, removes listeners, and resets expansion', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();

    sheet.destroy();
    sheet.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();

    renderReady(sheet, successState);
    expect(
      requiredElement('[data-taptranslate-sheet]').getAttribute(
        'data-expanded',
      ),
    ).toBe('false');
  });

  it('restores prior focus only when focus ended inside the sheet', () => {
    const previous = document.createElement('button');
    document.body.append(previous);
    previous.focus();
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-close]').focus();

    sheet.destroy();

    expect(document.activeElement).toBe(previous);

    renderReady(sheet, successState);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    sheet.destroy();
    expect(document.activeElement).toBe(outside);
  });
});

class FakeVisualViewport extends EventTarget {
  public width = 402;
  public height = 714;
  public scale = 1;
  public offsetLeft = 0;
  public offsetTop = 0;
}

function stubVisualViewport(): FakeVisualViewport {
  const viewport = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  return viewport;
}

function isExpanded(): boolean {
  return (
    requiredElement('[data-taptranslate-sheet]').getAttribute(
      'data-expanded',
    ) === 'true'
  );
}

function pointer(
  type: string,
  target: HTMLElement,
  clientY: number,
  pointerId = 1,
  pointerType = 'mouse',
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientY,
      pointerId,
      isPrimary: true,
      pointerType,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

function swipe(target: HTMLElement, fromY: number, toY: number): void {
  pointer('pointerdown', target, fromY);
  pointer('pointermove', target, toY);
  pointer('pointerup', target, toY);
}

interface FakeTouchOptions {
  readonly cancelable?: boolean;
  readonly touchCount?: number;
}

// jsdom has no Touch constructor, so tests build touch events by hand.
function touch(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  target: HTMLElement,
  clientY: number,
  options: FakeTouchOptions = {},
): Event {
  const event = new Event(type, {
    bubbles: true,
    composed: true,
    cancelable: options.cancelable ?? true,
  });
  const point = { identifier: 1, clientX: 10, clientY, target };
  const active =
    type === 'touchend' || type === 'touchcancel'
      ? []
      : Array.from({ length: options.touchCount ?? 1 }, (_, index) => ({
          ...point,
          identifier: index + 1,
        }));
  Object.defineProperties(event, {
    touches: { value: active },
    targetTouches: { value: active },
    changedTouches: { value: [point] },
  });
  target.dispatchEvent(event);
  return event;
}

function touchSwipe(target: HTMLElement, fromY: number, toY: number): Event {
  touch('touchstart', target, fromY);
  const move = touch('touchmove', target, toY);
  touch('touchend', target, toY);
  return move;
}

function setContentScroll(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): void {
  Object.defineProperties(requiredElement('.content'), {
    scrollTop: { configurable: true, value: scrollTop },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
}

describe('TranslationSheet visual viewport', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('covers the visual viewport and cancels the page zoom', () => {
    const viewport = stubVisualViewport();
    viewport.width = 200;
    viewport.height = 350;
    viewport.scale = 2;
    viewport.offsetLeft = 30;
    viewport.offsetTop = 40;
    const { sheet } = createSheet();

    renderReady(sheet, successState);

    const overlay = requiredElement('.overlay');
    expect(overlay.style.width).toBe('400px');
    expect(overlay.style.height).toBe('700px');
    expect(overlay.style.transform).toBe('translate(30px, 40px) scale(0.5)');

    requiredElement('[data-taptranslate-expand]').click();

    expect(requiredElement('.overlay').style.height).toBe('700px');
  });

  it('follows viewport resize and scroll until the sheet is destroyed', () => {
    const viewport = stubVisualViewport();
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    expect(requiredElement('.overlay').style.height).toBe('714px');

    viewport.height = 812;
    viewport.dispatchEvent(new Event('resize'));
    expect(requiredElement('.overlay').style.height).toBe('812px');

    viewport.offsetTop = 25;
    viewport.dispatchEvent(new Event('scroll'));
    expect(requiredElement('.overlay').style.transform).toBe(
      'translate(0px, 25px) scale(1)',
    );

    const removeListener = vi.spyOn(viewport, 'removeEventListener');
    sheet.destroy();

    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('keeps stylesheet sizing when the visual viewport is unavailable', () => {
    const { sheet } = createSheet();

    renderReady(sheet, successState);

    expect(requiredElement('.overlay').style.width).toBe('');
    expect(requiredElement('.overlay').style.transform).toBe('');
  });
});

describe('TranslationSheet mouse swipe gestures', () => {
  it('expands on an upward swipe and collapses on a downward swipe', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);

    swipe(requiredElement('[data-taptranslate-expand]'), 300, 240);
    expect(isExpanded()).toBe(true);
    expect(
      requiredShadowRoot().querySelector('[data-taptranslate-sentence]'),
    ).not.toBeNull();

    swipe(requiredElement('[data-taptranslate-expand]'), 100, 160);
    expect(isExpanded()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('closes on a downward swipe from the compact sheet', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);

    swipe(requiredElement('.topbar'), 300, 360);

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('treats a short movement as a tap and ignores the click after a swipe', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);

    swipe(requiredElement('[data-taptranslate-expand]'), 300, 296);
    expect(isExpanded()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();

    requiredElement('[data-taptranslate-expand]').click();
    expect(isExpanded()).toBe(true);

    swipe(requiredElement('[data-taptranslate-expand]'), 100, 160);
    requiredElement('[data-taptranslate-expand]').click();
    expect(isExpanded()).toBe(false);

    requiredElement('[data-taptranslate-expand]').click();
    expect(isExpanded()).toBe(true);
  });

  it('moves the sheet with a downward drag and restores it on release', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const handle = requiredElement('[data-taptranslate-expand]');
    const sheetElement = requiredElement('[data-taptranslate-sheet]');

    pointer('pointerdown', handle, 300);
    pointer('pointermove', handle, 330);
    expect(sheetElement.style.transform).toBe('translateY(30px)');

    pointer('pointerup', handle, 310);
    expect(sheetElement.style.transform).toBe('');
    expect(isExpanded()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('restores the sheet when the browser cancels the gesture', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const handle = requiredElement('[data-taptranslate-expand]');
    const sheetElement = requiredElement('[data-taptranslate-sheet]');

    pointer('pointerdown', handle, 300);
    pointer('pointermove', handle, 380);
    pointer('pointercancel', handle, 380);
    pointer('pointerup', handle, 380);

    expect(sheetElement.style.transform).toBe('');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('cancels a mouse drag when the button is no longer pressed', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const topbar = requiredElement('.topbar');
    const mouse = (type: string, clientY: number, buttons: number): void => {
      topbar.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientY,
          buttons,
          pointerId: 1,
          isPrimary: true,
          pointerType: 'mouse',
        }),
      );
    };

    mouse('pointerdown', 300, 1);
    mouse('pointermove', 380, 0);
    mouse('pointerup', 380, 0);

    expect(dismiss).not.toHaveBeenCalled();
    expect(requiredElement('[data-taptranslate-sheet]').style.transform).toBe(
      '',
    );
  });

  it('does not start a swipe on the close button or for another pointer', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const close = requiredElement('[data-taptranslate-close]');
    const handle = requiredElement('[data-taptranslate-expand]');

    swipe(close, 300, 360);
    pointer('pointerdown', handle, 300, 1);
    pointer('pointermove', handle, 360, 2);
    pointer('pointerup', handle, 360, 2);

    expect(dismiss).not.toHaveBeenCalled();
    expect(isExpanded()).toBe(false);
  });

  it('leaves touch pointers to the touch event handlers', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const handle = requiredElement('[data-taptranslate-expand]');

    pointer('pointerdown', handle, 300, 1, 'touch');
    pointer('pointermove', handle, 360, 1, 'touch');
    pointer('pointerup', handle, 360, 1, 'touch');

    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('TranslationSheet touch gestures', () => {
  it('expands the compact sheet on an upward swipe on its content', () => {
    const { sheet } = createSheet();
    renderReady(sheet, successState);

    const move = touchSwipe(
      requiredElement('[data-taptranslate-explanation]'),
      500,
      440,
    );

    expect(move.defaultPrevented).toBe(true);
    expect(isExpanded()).toBe(true);
  });

  it('closes the compact sheet on a downward swipe on its content', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);

    const move = touchSwipe(
      requiredElement('[data-taptranslate-explanation]'),
      500,
      560,
    );

    expect(move.defaultPrevented).toBe(true);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps a short touch on the compact sheet from scrolling the page', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const explanation = requiredElement('[data-taptranslate-explanation]');

    const move = touchSwipe(explanation, 500, 497);
    touch('touchstart', explanation, 500);
    touch('touchend', explanation, 500);

    expect(move.defaultPrevented).toBe(true);
    expect(isExpanded()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
    requiredElement('[data-taptranslate-expand]').click();
    expect(isExpanded()).toBe(true);
  });

  it('follows a downward touch drag and restores the sheet on release', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const explanation = requiredElement('[data-taptranslate-explanation]');
    const sheetElement = requiredElement('[data-taptranslate-sheet]');

    touch('touchstart', explanation, 500);
    touch('touchmove', explanation, 530);
    expect(sheetElement.style.transform).toBe('translateY(30px)');

    touch('touchend', explanation, 510);
    expect(sheetElement.style.transform).toBe('');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('collapses the expanded sheet when its content is at the top', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();
    setContentScroll(0, 1000, 400);

    const move = touchSwipe(
      requiredElement('[data-taptranslate-explanation]'),
      300,
      360,
    );

    expect(move.defaultPrevented).toBe(true);
    expect(isExpanded()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('lets the expanded content scroll natively', () => {
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();
    const explanation = requiredElement('[data-taptranslate-explanation]');

    setContentScroll(120, 1000, 400);
    const down = touchSwipe(explanation, 300, 360);
    setContentScroll(0, 1000, 400);
    const up = touchSwipe(explanation, 300, 240);

    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(isExpanded()).toBe(true);
  });

  it('blocks page scrolling when the expanded content cannot scroll', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();
    const explanation = requiredElement('[data-taptranslate-explanation]');

    setContentScroll(0, 300, 400);
    const shortContent = touchSwipe(explanation, 300, 240);
    setContentScroll(600, 1000, 400);
    const atBottom = touchSwipe(explanation, 300, 240);

    expect(shortContent.defaultPrevented).toBe(true);
    expect(atBottom.defaultPrevented).toBe(true);
    expect(isExpanded()).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('drags the expanded sheet by its top bar', () => {
    const { sheet } = createSheet();
    renderReady(sheet, successState);
    requiredElement('[data-taptranslate-expand]').click();

    touchSwipe(requiredElement('[data-taptranslate-expand]'), 100, 160);

    expect(isExpanded()).toBe(false);
  });

  it('stops handling a swipe after the browser starts scrolling', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const explanation = requiredElement('[data-taptranslate-explanation]');

    touch('touchstart', explanation, 500);
    const move = touch('touchmove', explanation, 560, { cancelable: false });
    touch('touchend', explanation, 560);

    expect(move.defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
    expect(requiredElement('[data-taptranslate-sheet]').style.transform).toBe(
      '',
    );
  });

  it('ignores multi-touch gestures', () => {
    const { sheet, dismiss } = createSheet();
    renderReady(sheet, successState);
    const explanation = requiredElement('[data-taptranslate-explanation]');

    touch('touchstart', explanation, 500, { touchCount: 2 });
    const move = touch('touchmove', explanation, 560, { touchCount: 2 });
    touch('touchend', explanation, 560);

    expect(move.defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('translationSheetStyles', () => {
  it('encodes the responsive non-modal and accessibility constraints', () => {
    expect(translationSheetStyles).toContain('position: fixed');
    expect(translationSheetStyles).toContain('z-index: 2147483647');
    expect(translationSheetStyles).toContain('pointer-events: none');
    expect(translationSheetStyles).toContain('pointer-events: auto');
    expect(translationSheetStyles).toContain('max-height: 52%');
    expect(translationSheetStyles).toContain(
      'height: calc(100% - 16px - env(safe-area-inset-top))',
    );
    expect(translationSheetStyles).not.toMatch(/\d+vh\b/);
    expect(translationSheetStyles).toMatch(
      /\.topbar\s*\{[\s\S]*?touch-action: none;[\s\S]*?\}/,
    );
    expect(translationSheetStyles).toMatch(
      /\.sheet\[data-expanded='false'\]\s*\{[\s\S]*?touch-action: none;[\s\S]*?\}/,
    );
    expect(translationSheetStyles).toMatch(
      /@media \(pointer: coarse\)\s*\{[\s\S]*?\.sheet\[data-expanded='false'\] \.content\s*\{\s*overflow-y: hidden;/,
    );
    expect(translationSheetStyles).toContain('max-width: 640px');
    expect(translationSheetStyles).toContain(':focus-visible');
    expect(translationSheetStyles).toMatch(
      /\.close\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?\}/,
    );
    expect(translationSheetStyles).toContain(
      '@media (prefers-reduced-motion: reduce)',
    );
  });
});
