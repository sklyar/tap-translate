import type {
  TranslationView,
  TranslationViewState,
} from './translation-controller';
import type { FocusContextBlock } from './detection';
import type { TranslationRequest } from './translation';

export interface TranslationSheetCallbacks {
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}

// A vertical movement must be at least this long to count as a swipe. A
// shorter movement is a tap and keeps the button behavior.
const dragStartDistance = 8;
const swipeDistance = 40;

// How a touch gesture on the sheet is handled, decided on its first move:
// - sheet: the gesture moves, expands, collapses, or closes the sheet;
// - native: the browser scrolls the sheet content;
// - blocked: nothing can scroll, so the gesture is cancelled to keep the page
//   under the sheet from scrolling.
type TouchMode = 'undecided' | 'sheet' | 'native' | 'blocked';

interface DragGesture {
  readonly input: 'mouse' | 'touch';
  // The pointer id for a mouse drag or the touch identifier for a touch drag.
  readonly id: number;
  readonly startY: number;
  readonly sheet: HTMLElement;
  // The sheet content element when a touch starts inside it.
  readonly content: HTMLElement | null;
  mode: TouchMode;
  active: boolean;
}

export class TranslationSheet implements TranslationView {
  private readonly documentRoot: Document;
  private readonly callbacks: TranslationSheetCallbacks;
  private readonly stylesheetUrl: string | undefined;
  private host: HTMLElement | undefined;
  private shadowRoot: ShadowRoot | undefined;
  private stylesheetElement: HTMLLinkElement | undefined;
  private overlayElement: HTMLElement | undefined;
  private visualViewport: VisualViewport | undefined;
  private dragGesture: DragGesture | undefined;
  private suppressHandleClick = false;
  private stylesheetReady = false;
  private failedStylesheetRequest: TranslationRequest | undefined;
  private currentState: TranslationViewState | undefined;
  private previouslyFocused: HTMLElement | undefined;
  private focusCaptureComplete = false;
  private expanded = false;

  public constructor(
    documentRoot: Document,
    callbacks: TranslationSheetCallbacks,
    stylesheetUrl?: string,
  ) {
    this.documentRoot = documentRoot;
    this.callbacks = callbacks;
    this.stylesheetUrl = stylesheetUrl;
  }

  public render(state: TranslationViewState): void {
    const requestChanged = this.currentState?.request !== state.request;
    this.currentState = state;
    if (requestChanged) {
      this.failedStylesheetRequest = undefined;
    }
    if (this.failedStylesheetRequest === state.request) {
      return;
    }
    this.ensureMounted();
    this.renderCurrentState();
  }

  public destroy(): void {
    const shouldRestoreFocus =
      this.shadowRoot !== undefined && this.shadowRoot.activeElement !== null;
    const previouslyFocused = this.previouslyFocused;

    this.releaseMount();
    this.currentState = undefined;
    this.previouslyFocused = undefined;
    this.focusCaptureComplete = false;
    this.expanded = false;
    this.failedStylesheetRequest = undefined;

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

  private readonly handleStylesheetLoad = (event: Event): void => {
    if (event.currentTarget !== this.stylesheetElement) {
      return;
    }

    this.removeStylesheetListeners();
    this.stylesheetReady = true;
    try {
      this.renderCurrentState();
      if (this.host !== undefined) {
        this.host.hidden = false;
      }
    } catch {
      this.failCurrentStylesheet();
    }
  };

  private readonly handleStylesheetError = (event: Event): void => {
    if (event.currentTarget !== this.stylesheetElement) {
      return;
    }

    this.failCurrentStylesheet();
  };

  private readonly handleViewportChange = (): void => {
    if (this.overlayElement !== undefined) {
      applyViewportGeometry(this.overlayElement, this.visualViewport);
    }
  };

  // Mouse drags start only on the top bar. Touch input uses the touch event
  // handlers below, so touch pointers are ignored here.
  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.suppressHandleClick = false;
    const topbar = event.currentTarget;
    if (
      event.pointerType !== 'mouse' ||
      !event.isPrimary ||
      event.button !== 0 ||
      !(topbar instanceof HTMLElement) ||
      topbar.parentElement === null ||
      isInsideCloseButton(event.target)
    ) {
      return;
    }

    this.dragGesture = {
      input: 'mouse',
      id: event.pointerId,
      startY: event.clientY,
      sheet: topbar.parentElement,
      content: null,
      mode: 'sheet',
      active: false,
    };
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const gesture = this.dragGesture;
    if (gesture?.input !== 'mouse' || gesture.id !== event.pointerId) {
      return;
    }

    // A mouse button released outside the top bar sends no pointerup here.
    if (event.buttons === 0) {
      this.cancelDrag();
      return;
    }

    this.moveSheet(gesture, event.clientY - gesture.startY, () => {
      capturePointer(event.currentTarget, event.pointerId);
    });
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const gesture = this.dragGesture;
    if (gesture?.input === 'mouse' && gesture.id === event.pointerId) {
      this.finishSwipe(gesture, event.clientY - gesture.startY);
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    const gesture = this.dragGesture;
    if (gesture?.input === 'mouse' && gesture.id === event.pointerId) {
      this.cancelDrag();
    }
  };

  private readonly handleTouchStart = (event: TouchEvent): void => {
    this.suppressHandleClick = false;
    const sheet = event.currentTarget;
    const touch = event.changedTouches[0];
    if (
      event.touches.length !== 1 ||
      touch === undefined ||
      !(sheet instanceof HTMLElement) ||
      isInsideCloseButton(event.target)
    ) {
      this.cancelDrag();
      return;
    }

    const content =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.content')
        : null;
    this.dragGesture = {
      input: 'touch',
      id: touch.identifier,
      startY: touch.clientY,
      sheet,
      content,
      mode: 'undecided',
      active: false,
    };
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    const gesture = this.dragGesture;
    const touch =
      gesture?.input === 'touch'
        ? findTouch(event.changedTouches, gesture.id)
        : undefined;
    if (gesture === undefined || touch === undefined) {
      return;
    }

    const distance = touch.clientY - gesture.startY;
    if (gesture.mode === 'undecided') {
      if (distance === 0) {
        return;
      }
      gesture.mode = this.chooseTouchMode(gesture.content, distance);
    }

    if (gesture.mode === 'native') {
      return;
    }

    // Once the browser starts scrolling, touchmove is no longer cancelable.
    if (!event.cancelable) {
      gesture.mode = 'native';
      this.resetSheetPosition(gesture.sheet);
      return;
    }

    event.preventDefault();
    if (gesture.mode === 'sheet') {
      this.moveSheet(gesture, distance);
    }
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    const gesture = this.dragGesture;
    const touch =
      gesture?.input === 'touch'
        ? findTouch(event.changedTouches, gesture.id)
        : undefined;
    if (gesture === undefined || touch === undefined) {
      return;
    }

    if (gesture.mode === 'sheet') {
      this.finishSwipe(gesture, touch.clientY - gesture.startY);
    } else {
      this.cancelDrag();
    }
  };

  private readonly handleTouchCancel = (): void => {
    if (this.dragGesture?.input === 'touch') {
      this.cancelDrag();
    }
  };

  // The compact sheet always handles a swipe itself: up expands and down
  // closes. The expanded sheet lets its content scroll and collapses only on a
  // downward swipe when the content is already at the top.
  private chooseTouchMode(
    content: HTMLElement | null,
    distance: number,
  ): TouchMode {
    if (!this.expanded || content === null) {
      return 'sheet';
    }

    if (distance > 0) {
      return content.scrollTop <= 0 ? 'sheet' : 'native';
    }

    return content.scrollTop + content.clientHeight < content.scrollHeight - 1
      ? 'native'
      : 'blocked';
  }

  private moveSheet(
    gesture: DragGesture,
    distance: number,
    onStart?: () => void,
  ): void {
    if (!gesture.active) {
      if (Math.abs(distance) < dragStartDistance) {
        return;
      }
      gesture.active = true;
      onStart?.();
    }

    // Only a downward drag follows the finger. An upward swipe expands the
    // sheet when the gesture ends.
    gesture.sheet.style.transition = 'none';
    gesture.sheet.style.transform = `translateY(${String(Math.max(0, distance))}px)`;
  }

  private finishSwipe(gesture: DragGesture, distance: number): void {
    this.cancelDrag();
    if (!gesture.active) {
      return;
    }

    this.suppressHandleClick = true;
    if (distance <= -swipeDistance && !this.expanded) {
      this.setExpanded(true);
    } else if (distance >= swipeDistance && this.expanded) {
      this.setExpanded(false);
    } else if (distance >= swipeDistance) {
      this.safeCallback(this.callbacks.onDismiss);
    }
  }

  private cancelDrag(): void {
    const gesture = this.dragGesture;
    this.dragGesture = undefined;
    if (gesture !== undefined) {
      this.resetSheetPosition(gesture.sheet);
    }
  }

  private resetSheetPosition(sheet: HTMLElement): void {
    sheet.style.removeProperty('transition');
    sheet.style.removeProperty('transform');
  }

  private ensureMounted(): void {
    if (this.isMountConnected()) {
      return;
    }

    if (
      this.host !== undefined ||
      this.shadowRoot !== undefined ||
      this.stylesheetElement !== undefined ||
      this.overlayElement !== undefined
    ) {
      this.releaseMount();
    }

    const stylesheetUrl = this.stylesheetUrl ?? getExtensionStylesheetUrl();
    if (stylesheetUrl === undefined || stylesheetUrl.length === 0) {
      this.failedStylesheetRequest = this.currentState?.request;
      return;
    }

    if (!this.focusCaptureComplete) {
      this.previouslyFocused = getRestorableActiveElement(this.documentRoot);
      this.focusCaptureComplete = true;
    }

    const host = this.documentRoot.createElement('div');
    host.hidden = true;
    host.setAttribute('data-taptranslate-sheet-host', '');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const stylesheetElement = this.documentRoot.createElement('link');
    stylesheetElement.rel = 'stylesheet';
    stylesheetElement.href = stylesheetUrl;
    stylesheetElement.setAttribute('data-taptranslate-stylesheet', '');
    stylesheetElement.addEventListener('load', this.handleStylesheetLoad, {
      once: true,
    });
    stylesheetElement.addEventListener('error', this.handleStylesheetError, {
      once: true,
    });

    this.host = host;
    this.shadowRoot = shadowRoot;
    this.stylesheetElement = stylesheetElement;
    this.documentRoot.documentElement.append(host);
    this.documentRoot.addEventListener('keydown', this.handleKeyDown);
    this.visualViewport =
      this.documentRoot.defaultView?.visualViewport ?? undefined;
    this.visualViewport?.addEventListener('resize', this.handleViewportChange);
    this.visualViewport?.addEventListener('scroll', this.handleViewportChange);
    shadowRoot.append(stylesheetElement);
  }

  private isMountConnected(): boolean {
    return (
      this.host !== undefined &&
      this.shadowRoot !== undefined &&
      this.stylesheetElement !== undefined &&
      this.host.isConnected &&
      this.host.ownerDocument === this.documentRoot &&
      this.host.shadowRoot === this.shadowRoot &&
      this.stylesheetElement.parentNode === this.shadowRoot
    );
  }

  private releaseMount(): void {
    if (
      this.host !== undefined ||
      this.shadowRoot !== undefined ||
      this.stylesheetElement !== undefined ||
      this.overlayElement !== undefined
    ) {
      this.documentRoot.removeEventListener('keydown', this.handleKeyDown);
    }
    this.visualViewport?.removeEventListener(
      'resize',
      this.handleViewportChange,
    );
    this.visualViewport?.removeEventListener(
      'scroll',
      this.handleViewportChange,
    );
    this.removeStylesheetListeners();
    this.host?.remove();
    this.host = undefined;
    this.shadowRoot = undefined;
    this.stylesheetElement = undefined;
    this.overlayElement = undefined;
    this.visualViewport = undefined;
    this.dragGesture = undefined;
    this.stylesheetReady = false;
  }

  private renderCurrentState(): void {
    const state = this.currentState;
    const shadowRoot = this.shadowRoot;
    if (
      state === undefined ||
      shadowRoot === undefined ||
      !this.stylesheetReady
    ) {
      return;
    }

    const overlay = this.createOverlay(state);
    applyViewportGeometry(overlay, this.visualViewport);
    this.dragGesture = undefined;
    this.overlayElement?.remove();
    shadowRoot.append(overlay);
    this.overlayElement = overlay;
  }

  private failCurrentStylesheet(): void {
    const failedRequest = this.currentState?.request;
    this.releaseMount();
    this.failedStylesheetRequest = failedRequest;
  }

  private removeStylesheetListeners(): void {
    this.stylesheetElement?.removeEventListener(
      'load',
      this.handleStylesheetLoad,
    );
    this.stylesheetElement?.removeEventListener(
      'error',
      this.handleStylesheetError,
    );
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

    sheet.addEventListener('touchstart', this.handleTouchStart, {
      passive: true,
    });
    // Not passive: the first move decides whether to cancel page scrolling.
    sheet.addEventListener('touchmove', this.handleTouchMove, {
      passive: false,
    });
    sheet.addEventListener('touchend', this.handleTouchEnd);
    sheet.addEventListener('touchcancel', this.handleTouchCancel);
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
      // The click that some browsers fire after a swipe must not toggle again.
      if (this.suppressHandleClick) {
        this.suppressHandleClick = false;
        return;
      }
      const restoreFocus = this.shadowRoot?.activeElement === handle;
      this.setExpanded(!this.expanded);
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

    topbar.addEventListener('pointerdown', this.handlePointerDown);
    topbar.addEventListener('pointermove', this.handlePointerMove);
    topbar.addEventListener('pointerup', this.handlePointerUp);
    topbar.addEventListener('pointercancel', this.handlePointerCancel);
    topbar.append(handle, close);
    return topbar;
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.renderCurrentState();
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

// The host is fixed to the layout viewport. Safari can show a smaller area
// (an expanded toolbar, the keyboard) or a zoomed part of the page (pinch
// zoom). The overlay covers exactly the visual viewport and cancels the page
// zoom, so the sheet keeps its size and stays at the bottom of the screen.
function applyViewportGeometry(
  overlay: HTMLElement,
  viewport: VisualViewport | undefined,
): void {
  if (viewport === undefined) {
    return;
  }

  const { width, height, scale, offsetLeft, offsetTop } = viewport;
  if (
    ![width, height, scale, offsetLeft, offsetTop].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    scale <= 0
  ) {
    return;
  }

  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.width = `${String(width * scale)}px`;
  overlay.style.height = `${String(height * scale)}px`;
  overlay.style.transform = `translate(${String(offsetLeft)}px, ${String(offsetTop)}px) scale(${String(1 / scale)})`;
}

function findTouch(list: TouchList, identifier: number): Touch | undefined {
  for (const touch of list) {
    if (touch.identifier === identifier) {
      return touch;
    }
  }
  return undefined;
}

function isInsideCloseButton(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-taptranslate-close]') !== null
  );
}

function capturePointer(target: EventTarget | null, pointerId: number): void {
  if (!(target instanceof Element)) {
    return;
  }
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is optional. Touch input is captured implicitly.
  }
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

interface WebExtensionRuntime {
  getURL(path: string): string;
}

interface WebExtensionGlobal {
  readonly browser?: { readonly runtime?: WebExtensionRuntime };
  readonly chrome?: { readonly runtime?: WebExtensionRuntime };
}

function getExtensionStylesheetUrl(): string | undefined {
  const extensionGlobal = globalThis as typeof globalThis & WebExtensionGlobal;
  const runtime =
    extensionGlobal.browser?.runtime ?? extensionGlobal.chrome?.runtime;
  try {
    return runtime?.getURL('translation-sheet.css');
  } catch {
    return undefined;
  }
}
