import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from './translation';

export type TranslationViewState =
  | {
      readonly kind: 'loading';
      readonly request: TranslationRequest;
    }
  | {
      readonly kind: 'success';
      readonly request: TranslationRequest;
      readonly result: TranslationResult;
    }
  | {
      readonly kind: 'error';
      readonly request: TranslationRequest;
    };

export interface TranslationView {
  render(state: TranslationViewState): void;
  destroy(): void;
}

interface ActiveTranslation {
  readonly request: TranslationRequest;
  readonly abortController: AbortController;
}

export class TranslationController {
  private activeTranslation: ActiveTranslation | undefined;
  private readonly provider: TranslationProvider;
  private readonly view: TranslationView;

  public constructor(provider: TranslationProvider, view: TranslationView) {
    this.provider = provider;
    this.view = view;
  }

  public translate(request: TranslationRequest): void {
    this.start(request);
  }

  public retry(): void {
    const request = this.activeTranslation?.request;
    if (request !== undefined) {
      this.start(request);
    }
  }

  public dismiss(): void {
    const activeTranslation = this.activeTranslation;
    this.activeTranslation = undefined;
    activeTranslation?.abortController.abort();
    this.safeDestroy();
  }

  private start(request: TranslationRequest): void {
    this.activeTranslation?.abortController.abort();

    const activeTranslation: ActiveTranslation = {
      request,
      abortController: new AbortController(),
    };
    this.activeTranslation = activeTranslation;

    if (
      !this.safeRender(
        { kind: 'loading', request },
        activeTranslation.abortController,
      )
    ) {
      return;
    }

    let translation: Promise<TranslationResult>;
    try {
      translation = this.provider.translate(request, {
        signal: activeTranslation.abortController.signal,
      });
    } catch (error) {
      this.handleFailure(activeTranslation, error);
      return;
    }

    void translation.then(
      (result) => {
        this.handleSuccess(activeTranslation, result);
      },
      (error: unknown) => {
        this.handleFailure(activeTranslation, error);
      },
    );
  }

  private handleSuccess(
    activeTranslation: ActiveTranslation,
    result: TranslationResult,
  ): void {
    if (!this.isCurrent(activeTranslation)) {
      return;
    }

    this.safeRender(
      {
        kind: 'success',
        request: activeTranslation.request,
        result,
      },
      activeTranslation.abortController,
    );
  }

  private handleFailure(
    activeTranslation: ActiveTranslation,
    error: unknown,
  ): void {
    if (!this.isCurrent(activeTranslation) || isAbortError(error)) {
      return;
    }

    this.safeRender(
      { kind: 'error', request: activeTranslation.request },
      activeTranslation.abortController,
    );
  }

  private safeRender(
    state: TranslationViewState,
    abortController: AbortController,
  ): boolean {
    try {
      this.view.render(state);
      return true;
    } catch {
      if (this.activeTranslation?.abortController === abortController) {
        this.activeTranslation = undefined;
      }
      abortController.abort();
      this.safeDestroy();
      return false;
    }
  }

  private safeDestroy(): void {
    try {
      this.view.destroy();
    } catch {
      // The controller must never allow a presentation failure onto the page.
    }
  }

  private isCurrent(activeTranslation: ActiveTranslation): boolean {
    return (
      this.activeTranslation?.abortController ===
      activeTranslation.abortController
    );
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}
