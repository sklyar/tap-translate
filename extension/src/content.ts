import { detectEnglishContext } from './detection';
import { MockTranslationProvider } from './mock-translation-provider';
import { TranslationController } from './translation-controller';
import { TranslationSheet } from './translation-sheet';
import { createTranslationRequest } from './translation';
import type { DetectionInput, DetectionResult } from './detection';
import type { TranslationRequest } from './translation';

export interface TranslationContentController {
  translate(request: TranslationRequest): void;
  dismiss(): void;
}

export interface TranslationContentSheet {
  containsEventPath(path: readonly EventTarget[]): boolean;
}

export interface TapTranslateContentOptions {
  readonly documentRoot: Document;
  readonly controller: TranslationContentController;
  readonly sheet: TranslationContentSheet;
  readonly detect?: (
    input: DetectionInput,
    documentRoot?: Document,
  ) => DetectionResult | null;
}

export function startTapTranslateContent(
  options: TapTranslateContentOptions,
): () => void {
  const detect = options.detect ?? detectEnglishContext;
  const windowRoot = options.documentRoot.defaultView;
  let listening = true;

  const dismissForLifecycle = (): void => {
    try {
      options.controller.dismiss();
    } catch {
      // Lifecycle cleanup must not surface extension failures onto the page.
    }
  };

  const handlePageHide = (): void => {
    dismissForLifecycle();
  };

  const handleClick = (event: MouseEvent): void => {
    try {
      const eventPath = event.composedPath();
      if (options.sheet.containsEventPath(eventPath)) {
        return;
      }

      const result = detect(
        {
          point: {
            clientX: event.clientX,
            clientY: event.clientY,
          },
          target: event.target,
          eventPath,
        },
        options.documentRoot,
      );

      if (result === null) {
        options.controller.dismiss();
        return;
      }

      options.controller.translate(createTranslationRequest(result));
    } catch {
      console.error('[TapTranslate] Unexpected interaction failure.');
    }
  };

  options.documentRoot.addEventListener('click', handleClick, {
    capture: true,
    passive: true,
  });
  windowRoot?.addEventListener('pagehide', handlePageHide);

  return (): void => {
    if (!listening) {
      return;
    }
    listening = false;
    options.documentRoot.removeEventListener('click', handleClick, true);
    windowRoot?.removeEventListener('pagehide', handlePageHide);
    dismissForLifecycle();
  };
}

const provider = new MockTranslationProvider({
  attempts: [
    {
      type: 'success',
      delayMs: 350,
      result: {
        expression: 'turn off',
        translation: 'выключить',
        partOfSpeech: 'phrasal verb',
        explanation: 'Здесь означает выключить свет.',
      },
    },
  ],
});

const sheet = new TranslationSheet(document, {
  onRetry: retryTranslation,
  onDismiss: dismissTranslation,
});
const controller = new TranslationController(provider, sheet);

startTapTranslateContent({
  documentRoot: document,
  controller,
  sheet,
});

function retryTranslation(): void {
  controller.retry();
}

function dismissTranslation(): void {
  controller.dismiss();
}
