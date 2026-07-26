# Mock Translation Provider Design

Related: [product roadmap](2026-07-26-taptranslate-product-roadmap-design.md) and [Detection & Context Engine design](2026-07-26-detection-context-engine-design.md).

## Goal

Introduce the frontend translation boundary that will sit between the existing Detection & Context Engine and the future presentation layer. Define a minimal internal request/result contract and a deterministic mock provider that exercises success, delay, failure, retry, and cancellation without network access or UI work.

TapTranslate translates from English to Russian for this stage. Language selection and language fields are intentionally deferred.

## Scope

This stage includes:

- internal `TranslationRequest` and `TranslationResult` types;
- a pure conversion from `DetectionResult` to `TranslationRequest`;
- a replaceable `TranslationProvider` interface;
- a deterministic, configurable mock provider;
- pure unit tests for request conversion and provider behavior.

This stage does not include presentation UI, changes to the content-script wiring or accepted-hit debug effect, HTTP, a backend adapter or backend API schema, background scripts, storage, automatic retry or backoff, Xcode containers, or language settings.

## Request contract

The existing `DetectionContext` is already a bounded, serializable translation context. The translation request wraps it directly instead of copying the selected word and sentence into duplicate strings.

```ts
interface TranslationRequest {
  readonly context: DetectionContext;
}
```

The selected English word remains the `focusBlock.word` UTF-16 span, and its containing sentence remains the `focusBlock.sentence` span. A provider derives both strings from `focusBlock.text`. The complete focus block, neighboring blocks, block ordering, and truncation flags remain available for contextual interpretation.

A pure `createTranslationRequest(result: DetectionResult): TranslationRequest` function copies only the `context` reference. The viewport `anchorRect` stays outside the provider boundary because it belongs to future presentation positioning. No runtime validation or deep copy is needed for this internal conversion: the detection pipeline already guarantees the `DetectionResult` invariants, and all involved types are readonly.

## Result contract

```ts
interface TranslationResult {
  readonly expression: string;
  readonly translation: string;
  readonly partOfSpeech: string;
  readonly explanation: string;
}
```

`expression` is the English expression selected through contextual interpretation and may differ from the clicked word. For example, clicking `turn` in `Turn the light off` may produce `expression: "turn off"` and `translation: "выключить"`.

`partOfSpeech` remains a displayable string rather than a closed union. This avoids prematurely defining a taxonomy for values such as `phrasal verb`, `idiom`, or future provider-specific categories. The result deliberately excludes alternatives, pronunciation, examples, confidence, identifiers, and transport metadata.

Providers must return meaningful non-empty result fields. Runtime validation of untrusted backend data belongs in the future backend adapter rather than this internal contract.

## Provider contract

```ts
interface TranslationOptions {
  readonly signal?: AbortSignal;
}

interface TranslationProvider {
  translate(
    request: TranslationRequest,
    options?: TranslationOptions,
  ): Promise<TranslationResult>;
}
```

A successful call resolves with `TranslationResult`. A provider failure rejects with an `Error`. Cancellation rejects with a `DOMException` whose name is `AbortError`, following the web-platform convention.

Retry is a new call to `translate()`. The provider interface has no `retry()` method, performs no automatic retries, and exposes no retry state. The future presentation layer will decide when the user starts another attempt.

## Deterministic mock provider

The mock provider is configured with a non-empty ordered sequence of attempts:

```ts
type MockTranslationAttempt =
  | {
      readonly type: "success";
      readonly result: TranslationResult;
      readonly delayMs?: number;
    }
  | {
      readonly type: "failure";
      readonly message: string;
      readonly delayMs?: number;
    };

interface MockTranslationProviderOptions {
  readonly attempts: readonly [
    MockTranslationAttempt,
    ...MockTranslationAttempt[],
  ];
}
```

`MockTranslationProvider` implements `TranslationProvider` and selects an attempt by invocation order. After the configured sequence is exhausted, subsequent calls repeat its last attempt. Consequently:

- one success attempt models stable success;
- a positive `delayMs` models latency for either outcome;
- one failure attempt models a persistent failure;
- a failure followed by a success models a user retry that succeeds.

The configured result determines mock translation content. The mock contains no hidden dictionary, magic request words, random behavior, clock reads, `fetch`, `XMLHttpRequest`, or other network access.

## Cancellation semantics

- If the supplied signal is already aborted, the call rejects immediately with `AbortError` and does not consume a configured attempt.
- Once a non-aborted call starts, its selected attempt is consumed.
- If the signal aborts during an artificial delay, the mock clears the pending timer, removes its abort listener, and rejects once with `AbortError`.
- An attempt cancelled after it starts remains consumed, so a later call advances to the next configured attempt.
- Aborting after an attempt settles has no effect.
- Every call settles at most once and leaves no pending timer or abort listener after settlement.

## Data flow and ownership

```text
DetectionResult
      |
      | createTranslationRequest (drops anchorRect)
      v
TranslationRequest
      |
      | TranslationProvider.translate(request, { signal })
      v
TranslationResult | rejected Promise
```

The future presentation layer will retain the original `DetectionResult` for viewport positioning and interaction state while passing the derived request to the selected provider. This stage does not connect the mock provider to `content.ts`, so current desktop Safari behavior and the temporary accepted-hit ring remain unchanged.

## Testing

Pure Vitest tests run without jsdom and cover:

- request conversion preserves the complete context and excludes `anchorRect`;
- the existing word and sentence spans derive `turn` and `Turn the light off` correctly;
- a configured success may return the expression `turn off`;
- immediate and artificially delayed success;
- delayed and persistent failure;
- failure on the first call followed by success on retry;
- repetition of the final configured attempt;
- an already-aborted signal without attempt consumption;
- cancellation during delay, with no late settlement;
- stable behavior when the signal aborts after settlement.

Vitest fake timers control all delayed scenarios. The full extension check continues to run formatting, linting, strict TypeScript type-checking, unit tests, and the Safari 15.4/iOS 15.4 production build. No production dependency is added.
