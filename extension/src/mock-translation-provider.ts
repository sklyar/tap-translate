import type {
  TranslationOptions,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from './translation';

export type MockTranslationAttempt =
  | {
      readonly type: 'success';
      readonly result: TranslationResult;
      readonly delayMs?: number;
    }
  | {
      readonly type: 'failure';
      readonly message: string;
      readonly delayMs?: number;
    };

export interface MockTranslationProviderOptions {
  readonly attempts: readonly [
    MockTranslationAttempt,
    ...MockTranslationAttempt[],
  ];
}

export class MockTranslationProvider implements TranslationProvider {
  private attemptIndex = 0;
  private readonly options: MockTranslationProviderOptions;

  public constructor(options: MockTranslationProviderOptions) {
    this.options = options;
  }

  public translate(
    request: TranslationRequest,
    options: TranslationOptions = {},
  ): Promise<TranslationResult> {
    void request;

    const signal = options.signal;

    if (signal?.aborted === true) {
      return Promise.reject(createAbortError());
    }

    const attempt = this.takeAttempt();
    const delayMs = attempt.delayMs ?? 0;

    if (!(delayMs > 0)) {
      return settleAttempt(attempt);
    }

    return new Promise<TranslationResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }

        if (signal !== undefined && abortListener !== undefined) {
          signal.removeEventListener('abort', abortListener);
          abortListener = undefined;
        }
      };

      abortListener = (): void => {
        cleanup();
        reject(createAbortError());
      };

      signal?.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(() => {
        cleanup();
        void settleAttempt(attempt).then(resolve, reject);
      }, delayMs);
    });
  }

  private takeAttempt(): MockTranslationAttempt {
    const attemptIndex = Math.min(
      this.attemptIndex,
      this.options.attempts.length - 1,
    );
    const attempt =
      this.options.attempts[attemptIndex] ?? this.options.attempts[0];
    this.attemptIndex += 1;
    return attempt;
  }
}

function settleAttempt(
  attempt: MockTranslationAttempt,
): Promise<TranslationResult> {
  return attempt.type === 'success'
    ? Promise.resolve(attempt.result)
    : Promise.reject(new Error(attempt.message));
}

function createAbortError(): DOMException {
  return new DOMException('Translation request was aborted.', 'AbortError');
}
