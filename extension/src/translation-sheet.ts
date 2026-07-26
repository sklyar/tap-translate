import { translationSheetStyles } from './translation-sheet-styles';
import type {
  TranslationView,
  TranslationViewState,
} from './translation-controller';
import type { FocusContextBlock } from './detection';

export interface TranslationSheetCallbacks {
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}

export class TranslationSheet implements TranslationView {
  private readonly documentRoot: Document;
  private readonly callbacks: TranslationSheetCallbacks;
  private host: HTMLElement | undefined;
  private shadowRoot: ShadowRoot | undefined;
  private styleElement: HTMLStyleElement | undefined;
  private currentState: TranslationViewState | undefined;
  private previouslyFocused: HTMLElement | undefined;
  private expanded = false;

  public constructor(
    documentRoot: Document,
    callbacks: TranslationSheetCallbacks,
  ) {
    this.documentRoot = documentRoot;
    this.callbacks = callbacks;
  }

  public render(state: TranslationViewState): void {
    this.currentState = state;
    this.ensureMounted();
    this.renderCurrentState();
  }

  public destroy(): void {
    const shouldRestoreFocus = this.shadowRoot?.activeElement !== null;
    const previouslyFocused = this.previouslyFocused;

    this.documentRoot.removeEventListener('keydown', this.handleKeyDown);
    this.host?.remove();
    this.host = undefined;
    this.shadowRoot = undefined;
    this.styleElement = undefined;
    this.currentState = undefined;
    this.previouslyFocused = undefined;
    this.expanded = false;

    if (
      shouldRestoreFocus &&
      previouslyFocused !== undefined &&
      isRestorableFocusTarget(previouslyFocused)
    ) {
      try {
        previouslyFocused.focus({ preventScroll: true });
      } catch {
        // Focus restoration is best-effort and must not affect the host page.
      }
    }
  }

  public containsEventPath(path: readonly EventTarget[]): boolean {
    return this.host !== undefined && path.includes(this.host);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.host !== undefined) {
      this.safeCallback(this.callbacks.onDismiss);
    }
  };

  private ensureMounted(): void {
    if (this.host !== undefined && this.shadowRoot !== undefined) {
      return;
    }

    this.previouslyFocused = getRestorableActiveElement(this.documentRoot);

    const host = this.documentRoot.createElement('div');
    host.setAttribute('data-taptranslate-sheet-host', '');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const styleElement = this.documentRoot.createElement('style');
    styleElement.textContent = translationSheetStyles;
    shadowRoot.append(styleElement);
    this.documentRoot.documentElement.append(host);
    this.documentRoot.addEventListener('keydown', this.handleKeyDown);

    this.host = host;
    this.shadowRoot = shadowRoot;
    this.styleElement = styleElement;
  }

  private renderCurrentState(): void {
    const state = this.currentState;
    const shadowRoot = this.shadowRoot;
    const styleElement = this.styleElement;
    if (
      state === undefined ||
      shadowRoot === undefined ||
      styleElement === undefined
    ) {
      return;
    }

    shadowRoot.replaceChildren(styleElement, this.createOverlay(state));
  }

  private createOverlay(state: TranslationViewState): HTMLElement {
    const overlay = this.createElement('div', 'overlay');
    const scrim = this.createElement('div', 'scrim');
    scrim.setAttribute('aria-hidden', 'true');

    const sheet = this.createElement('section', 'sheet');
    sheet.setAttribute('data-taptranslate-sheet', '');
    sheet.setAttribute('data-expanded', String(this.expanded));
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-labelledby', 'taptranslate-title');
    sheet.setAttribute('lang', 'ru');

    sheet.append(this.createTopbar(), this.createContent(state));
    overlay.append(scrim, sheet);
    return overlay;
  }

  private createTopbar(): HTMLElement {
    const topbar = this.createElement('div', 'topbar');
    const handle = this.createButton(
      'handle',
      this.expanded ? 'Свернуть перевод' : 'Развернуть перевод',
    );
    handle.setAttribute('data-taptranslate-expand', '');
    handle.setAttribute('aria-expanded', String(this.expanded));
    handle.addEventListener('click', () => {
      const restoreFocus = this.shadowRoot?.activeElement === handle;
      this.expanded = !this.expanded;
      this.renderCurrentState();
      if (restoreFocus) {
        this.focusCurrentHandle();
      }
    });

    const close = this.createButton('close', 'Закрыть перевод');
    close.setAttribute('data-taptranslate-close', '');
    close.setAttribute('aria-label', 'Закрыть перевод');
    close.textContent = '×';
    close.addEventListener('click', () => {
      this.safeCallback(this.callbacks.onDismiss);
    });

    topbar.append(handle, close);
    return topbar;
  }

  private createContent(state: TranslationViewState): HTMLElement {
    const content = this.createElement('div', 'content');

    switch (state.kind) {
      case 'loading':
        this.renderLoading(content);
        break;
      case 'success':
        this.renderSuccess(content, state);
        break;
      case 'error':
        this.renderError(content);
        break;
    }

    return content;
  }

  private renderLoading(content: HTMLElement): void {
    content.append(
      this.createHeading('Перевод', 'state-title'),
      this.createSkeleton(),
      this.createStatus('Переводим выражение…'),
    );
  }

  private renderSuccess(
    content: HTMLElement,
    state: Extract<TranslationViewState, { readonly kind: 'success' }>,
  ): void {
    const expression = this.createHeading(state.result.expression, 'title');
    expression.setAttribute('data-taptranslate-expression', '');
    expression.setAttribute('lang', 'en');

    const partOfSpeech = this.createElement('p', 'part-of-speech');
    partOfSpeech.textContent = state.result.partOfSpeech;

    const translation = this.createElement('p', 'translation');
    translation.setAttribute('data-taptranslate-translation', '');
    translation.setAttribute('lang', 'ru');
    translation.textContent = state.result.translation;

    const explanation = this.createElement('p', 'explanation');
    explanation.setAttribute('data-taptranslate-explanation', '');
    explanation.setAttribute('lang', 'ru');
    explanation.textContent = state.result.explanation;

    content.append(
      expression,
      partOfSpeech,
      translation,
      explanation,
      this.createStatus('Перевод готов.'),
    );

    if (this.expanded) {
      content.append(
        this.createSentenceSection(state.request.context.focusBlock),
      );
    }
  }

  private renderError(content: HTMLElement): void {
    const title = this.createHeading('Перевод недоступен', 'state-title');
    const message = this.createElement('p', 'state-message');
    message.textContent = 'Попробуйте ещё раз.';
    const retry = this.createButton('retry', 'Повторить перевод');
    retry.setAttribute('data-taptranslate-retry', '');
    retry.textContent = 'Повторить';
    retry.addEventListener('click', () => {
      this.safeCallback(this.callbacks.onRetry);
    });

    content.append(
      title,
      message,
      retry,
      this.createStatus('Не удалось получить перевод.'),
    );
  }

  private createSentenceSection(focusBlock: FocusContextBlock): HTMLElement {
    const section = this.createElement('section', 'sentence-section');
    const label = this.createElement('h3', 'section-label');
    label.textContent = 'Предложение';
    const sentence = this.createElement('p', 'sentence');
    sentence.setAttribute('data-taptranslate-sentence', '');
    sentence.setAttribute('lang', 'en');
    appendHighlightedSentence(this.documentRoot, sentence, focusBlock);
    section.append(label, sentence);
    return section;
  }

  private createHeading(text: string, className: string): HTMLHeadingElement {
    const heading = this.createElement('h2', className);
    heading.id = 'taptranslate-title';
    heading.textContent = text;
    return heading;
  }

  private createSkeleton(): HTMLElement {
    const skeleton = this.createElement('div', 'skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
      skeleton.append(this.createElement('div', 'skeleton-line'));
    }
    return skeleton;
  }

  private createStatus(message: string): HTMLElement {
    const status = this.createElement('div', 'visually-hidden');
    status.setAttribute('data-taptranslate-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.textContent = message;
    return status;
  }

  private createButton(className: string, label: string): HTMLButtonElement {
    const button = this.createElement('button', className);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    return button;
  }

  private createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className: string,
  ): HTMLElementTagNameMap[K] {
    const element = this.documentRoot.createElement(tagName);
    element.className = className;
    return element;
  }

  private focusCurrentHandle(): void {
    const handle = this.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-taptranslate-expand]',
    );
    try {
      handle?.focus({ preventScroll: true });
    } catch {
      // Preserving native button focus is best-effort.
    }
  }

  private safeCallback(callback: () => void): void {
    try {
      callback();
    } catch {
      // Sheet controls must not propagate extension failures to the page.
    }
  }
}

function appendHighlightedSentence(
  documentRoot: Document,
  container: HTMLElement,
  focusBlock: FocusContextBlock,
): void {
  const { text, sentence, word } = focusBlock;
  if (!isValidSpan(sentence, text.length)) {
    container.textContent = text;
    return;
  }

  const sentenceText = text.slice(sentence.start, sentence.end);
  if (
    !isValidSpan(word, text.length) ||
    word.start < sentence.start ||
    word.end > sentence.end
  ) {
    container.textContent = sentenceText;
    return;
  }

  const wordStart = word.start - sentence.start;
  const wordEnd = word.end - sentence.start;
  const mark = documentRoot.createElement('mark');
  mark.setAttribute('lang', 'en');
  mark.textContent = sentenceText.slice(wordStart, wordEnd);
  container.append(
    documentRoot.createTextNode(sentenceText.slice(0, wordStart)),
    mark,
    documentRoot.createTextNode(sentenceText.slice(wordEnd)),
  );
}

function isValidSpan(
  span: { readonly start: number; readonly end: number },
  textLength: number,
): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.start < span.end &&
    span.end <= textLength
  );
}

function getRestorableActiveElement(
  documentRoot: Document,
): HTMLElement | undefined {
  const activeElement = documentRoot.activeElement;
  return isHTMLElementInDocument(activeElement, documentRoot) &&
    isRestorableFocusTarget(activeElement)
    ? activeElement
    : undefined;
}

function isHTMLElementInDocument(
  value: Element | null,
  documentRoot: Document,
): value is HTMLElement {
  const htmlElement = documentRoot.defaultView?.HTMLElement;
  return htmlElement !== undefined && value instanceof htmlElement;
}

function isRestorableFocusTarget(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.tabIndex >= 0 &&
    !element.hasAttribute('disabled') &&
    !element.hasAttribute('hidden')
  );
}
