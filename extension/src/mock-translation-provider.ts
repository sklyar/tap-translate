import type {
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

  public translate(request: TranslationRequest): Promise<TranslationResult> {
    void request;

    const attemptIndex = Math.min(
      this.attemptIndex,
      this.options.attempts.length - 1,
    );
    const attempt =
      this.options.attempts[attemptIndex] ?? this.options.attempts[0];
    this.attemptIndex += 1;

    return attempt.type === 'success'
      ? Promise.resolve(attempt.result)
      : Promise.reject(new Error(attempt.message));
  }
}
