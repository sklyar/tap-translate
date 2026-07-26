import type { DetectionContext, DetectionResult } from './detection';

export interface TranslationRequest {
  readonly context: DetectionContext;
}

export interface TranslationResult {
  readonly expression: string;
  readonly translation: string;
  readonly partOfSpeech: string;
  readonly explanation: string;
}

export interface TranslationOptions {
  readonly signal?: AbortSignal;
}

export interface TranslationProvider {
  translate(
    request: TranslationRequest,
    options?: TranslationOptions,
  ): Promise<TranslationResult>;
}

export function createTranslationRequest(
  result: DetectionResult,
): TranslationRequest {
  return { context: result.context };
}
