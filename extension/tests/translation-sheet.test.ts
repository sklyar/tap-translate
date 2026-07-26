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

describe('translationSheetStyles', () => {
  it('encodes the responsive non-modal and accessibility constraints', () => {
    expect(translationSheetStyles).toContain('position: fixed');
    expect(translationSheetStyles).toContain('z-index: 2147483647');
    expect(translationSheetStyles).toContain('pointer-events: none');
    expect(translationSheetStyles).toContain('pointer-events: auto');
    expect(translationSheetStyles).toContain('max-height: 52vh');
    expect(translationSheetStyles).toContain(
      'height: calc(100vh - 16px - env(safe-area-inset-top))',
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
