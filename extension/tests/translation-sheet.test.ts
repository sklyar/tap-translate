// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslationSheet } from '../src/translation-sheet';
import { translationSheetStyles } from '../src/translation-sheet-styles';
import type { TranslationViewState } from '../src/translation-controller';
import type { TranslationRequest, TranslationResult } from '../src/translation';

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
  vi.restoreAllMocks();
});

function createSheet(): {
  readonly sheet: TranslationSheet;
  readonly retry: ReturnType<typeof vi.fn<() => void>>;
  readonly dismiss: ReturnType<typeof vi.fn<() => void>>;
} {
  const retry = vi.fn<() => void>();
  const dismiss = vi.fn<() => void>();
  const sheet = new TranslationSheet(document, {
    onRetry: (): void => {
      retry();
    },
    onDismiss: (): void => {
      dismiss();
    },
  });
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

describe('TranslationSheet rendering', () => {
  it('mounts one open shadow root and reuses it across state updates', () => {
    const { sheet } = createSheet();

    sheet.render(loadingState);
    const host = requiredHost();
    const shadowRoot = requiredShadowRoot();

    expect(shadowRoot.textContent).toContain('Переводим');
    expect(shadowRoot.querySelectorAll('style')).toHaveLength(1);
    expect(document.head.querySelector('style')).toBeNull();
    expect(
      shadowRoot.querySelector('[role="dialog"]')?.hasAttribute('aria-modal'),
    ).toBe(false);

    sheet.render(successState);

    expect(requiredHost()).toBe(host);
    expect(requiredShadowRoot()).toBe(shadowRoot);
    expect(
      document.querySelectorAll('[data-taptranslate-sheet-host]'),
    ).toHaveLength(1);
    expect(shadowRoot.querySelectorAll('style')).toHaveLength(1);
  });

  it('renders the contextual success hierarchy with language metadata', () => {
    const { sheet } = createSheet();

    sheet.render(successState);

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

    sheet.render({ kind: 'success', request, result: unsafeResult });

    const shadowRoot = requiredShadowRoot();
    expect(shadowRoot.querySelector('[data-injected]')).toBeNull();
    expect(shadowRoot.textContent).toContain('<img data-injected src=x>');
    expect(shadowRoot.textContent).toContain(
      '<script data-injected>bad()</script>',
    );
  });

  it('toggles expanded mode and highlights only the clicked source word', () => {
    const { sheet } = createSheet();
    sheet.render(successState);
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

    sheet.render({ kind: 'success', request: invalidRequest, result });
    requiredElement('[data-taptranslate-expand]').click();

    const sentence = requiredElement('[data-taptranslate-sentence]');
    expect(sentence.textContent).toBe('Turn the light off.');
    expect(sentence.querySelector('mark')).toBeNull();
  });
});

describe('TranslationSheet controls and lifecycle', () => {
  it('remounts a detached host while preserving state and expansion', () => {
    const { sheet } = createSheet();
    sheet.render(successState);
    requiredElement('[data-taptranslate-expand]').click();
    const staleHost = requiredHost();

    staleHost.remove();
    sheet.render(successState);

    expect(requiredHost()).not.toBe(staleHost);
    expect(
      document.querySelectorAll('[data-taptranslate-sheet-host]'),
    ).toHaveLength(1);
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

    sheet.render(successState);
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
    sheet.render(successState);

    requiredHost().remove();
    later.focus();
    sheet.render(successState);

    expect(document.activeElement).toBe(later);
    requiredElement('[data-taptranslate-close]').focus();
    sheet.destroy();
    expect(document.activeElement).toBe(original);
  });

  it('leaves no host or keydown listener after repeated recovery', () => {
    const { sheet, dismiss } = createSheet();

    for (let iteration = 0; iteration < 20; iteration += 1) {
      sheet.render(successState);
      requiredHost().remove();
      sheet.render(successState);
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

    sheet.render(loadingState);
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
    sheet.render(successState);

    const close = requiredElement('[data-taptranslate-close]');
    expect(close.getAttribute('aria-label')).toBe('Закрыть перевод');
    close.click();

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape without consuming the document event', () => {
    const { sheet, dismiss } = createSheet();
    const observer = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener('keydown', observer);
    sheet.render(successState);
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
    sheet.render(loadingState);
    const host = requiredHost();
    expect(sheet.containsEventPath([document, host])).toBe(true);
    expect(sheet.containsEventPath([document.body, document])).toBe(false);

    sheet.destroy();
    expect(sheet.containsEventPath([host])).toBe(false);
  });

  it('destroys idempotently, removes listeners, and resets expansion', () => {
    const { sheet, dismiss } = createSheet();
    sheet.render(successState);
    requiredElement('[data-taptranslate-expand]').click();

    sheet.destroy();
    sheet.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-taptranslate-sheet-host]')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();

    sheet.render(successState);
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
    sheet.render(successState);
    requiredElement('[data-taptranslate-close]').focus();

    sheet.destroy();

    expect(document.activeElement).toBe(previous);

    sheet.render(successState);
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
