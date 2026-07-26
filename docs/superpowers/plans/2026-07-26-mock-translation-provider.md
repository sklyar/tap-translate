# Mock Translation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal frontend translation contract and a deterministic mock provider with success, delay, failure, retry, and `AbortSignal` cancellation behavior.

**Architecture:** A pure adapter wraps the existing serializable `DetectionContext` and deliberately excludes viewport geometry. A small stateful mock implements the provider interface by assigning configured attempts in invocation order; web-platform promises, timers, and `AbortSignal` model asynchronous behavior without UI or network access.

**Tech Stack:** TypeScript 6.0.3, native ESM, Vitest 4.1.10 with fake timers, ESLint 10, Prettier 3.9.6, Vite 8.1.5, Safari 15.4/iOS 15.4 build targets.

## Global Constraints

- Translation direction is fixed to English → Russian; add no language fields or settings.
- Preserve strict TypeScript, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and the current native ESM setup.
- Add no production or development dependency.
- Do not modify `extension/src/content.ts`, the accepted-hit debug effect, or current Safari runtime wiring.
- Add no UI, HTTP, backend adapter, backend schema, background script, storage, Xcode container, automatic retry, backoff, DI framework, event bus, or state machine.
- Import `DetectionContext` and `DetectionResult` through the public `extension/src/detection.ts` module.
- Keep `anchorRect` outside `TranslationRequest`.
- A retry is a new `translate()` call controlled by the caller.
- Cancellation rejects with a `DOMException` named `AbortError`.
- Keep tests pure and independent from jsdom.

## File Structure

- `extension/src/translation.ts` — translation request/result types, provider interface, options, and pure conversion from `DetectionResult`.
- `extension/src/mock-translation-provider.ts` — deterministic attempt sequencing, delay, failure, and cancellation behavior.
- `extension/tests/translation.test.ts` — request conversion and result-shape coverage.
- `extension/tests/mock-translation-provider.test.ts` — provider success, failure, retry, concurrency, delay, and cancellation coverage.
- `docs/superpowers/plans/2026-07-26-mock-translation-provider.md` — this execution plan.

---

### Task 1: Translation Contract and Detection Adapter

**Files:**

- Create: `extension/src/translation.ts`
- Create: `extension/tests/translation.test.ts`

**Interfaces:**

- Consumes: `DetectionContext` and `DetectionResult` from `extension/src/detection.ts`.
- Produces: `TranslationRequest`, `TranslationResult`, `TranslationOptions`, `TranslationProvider`, and `createTranslationRequest(result: DetectionResult): TranslationRequest`.

- [ ] **Step 1: Write the failing contract and conversion tests**

Create `extension/tests/translation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { DetectionResult } from "../src/detection";
import {
  createTranslationRequest,
  type TranslationResult,
} from "../src/translation";

const detectionResult: DetectionResult = {
  anchorRect: { x: 10, y: 20, width: 8, height: 16 },
  context: {
    beforeBlocks: [
      {
        text: "The room was getting dark.",
        truncatedBefore: false,
        truncatedAfter: false,
      },
    ],
    focusBlock: {
      text: "Turn the light off.",
      word: { start: 0, end: 4 },
      sentence: { start: 0, end: 19 },
      truncatedBefore: false,
      truncatedAfter: false,
    },
    afterBlocks: [],
  },
};

describe("createTranslationRequest", () => {
  it("preserves translation context and excludes viewport geometry", () => {
    const request = createTranslationRequest(detectionResult);

    expect(request).toEqual({ context: detectionResult.context });
    expect(request).not.toHaveProperty("anchorRect");
    expect(JSON.parse(JSON.stringify(request)) as unknown).toEqual(request);
  });

  it("keeps the selected word and sentence derivable from spans", () => {
    const { text, word, sentence } =
      createTranslationRequest(detectionResult).context.focusBlock;

    expect(text.slice(word.start, word.end)).toBe("Turn");
    expect(text.slice(sentence.start, sentence.end)).toBe(
      "Turn the light off.",
    );
  });
});

describe("TranslationResult", () => {
  it("allows the contextual expression to differ from the clicked word", () => {
    const result: TranslationResult = {
      expression: "turn off",
      translation: "выключить",
      partOfSpeech: "phrasal verb",
      explanation: "Здесь означает выключить свет.",
    };

    expect(result.expression).toBe("turn off");
    expect(result.translation).toBe("выключить");
  });
});
```

- [ ] **Step 2: Run the focused test and verify that it fails**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation.test.ts
```

Expected: FAIL because `../src/translation` does not exist.

- [ ] **Step 3: Implement the minimal translation contract**

Create `extension/src/translation.ts`:

```ts
import type { DetectionContext, DetectionResult } from "./detection";

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
```

- [ ] **Step 4: Run focused and static checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation.test.ts
rtk npm run format
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 5: Commit the translation boundary**

```bash
rtk git add extension/src/translation.ts extension/tests/translation.test.ts
rtk git commit -m "feat(extension): add translation provider contract"
```

---

### Task 2: Deterministic Success, Failure, and Retry Attempts

**Files:**

- Create: `extension/src/mock-translation-provider.ts`
- Create: `extension/tests/mock-translation-provider.test.ts`

**Interfaces:**

- Consumes: `TranslationProvider`, `TranslationRequest`, and `TranslationResult` from `extension/src/translation.ts`.
- Produces: `MockTranslationAttempt`, `MockTranslationProviderOptions`, and `MockTranslationProvider implements TranslationProvider`.

- [ ] **Step 1: Write failing immediate-outcome tests**

Create `extension/tests/mock-translation-provider.test.ts` with the initial suite:

```ts
import { describe, expect, it, vi } from "vitest";

import { MockTranslationProvider } from "../src/mock-translation-provider";
import type { TranslationRequest, TranslationResult } from "../src/translation";

const request: TranslationRequest = {
  context: {
    beforeBlocks: [],
    focusBlock: {
      text: "Turn the light off.",
      word: { start: 0, end: 4 },
      sentence: { start: 0, end: 19 },
      truncatedBefore: false,
      truncatedAfter: false,
    },
    afterBlocks: [],
  },
};

const turnOffResult: TranslationResult = {
  expression: "turn off",
  translation: "выключить",
  partOfSpeech: "phrasal verb",
  explanation: "Здесь означает выключить свет.",
};

const switchOffResult: TranslationResult = {
  expression: "switch off",
  translation: "выключить",
  partOfSpeech: "phrasal verb",
  explanation: "Альтернативное выражение для выключения.",
};

describe("MockTranslationProvider immediate attempts", () => {
  it("returns a configured success without using the network", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network call"));
    const provider = new MockTranslationProvider({
      attempts: [{ type: "success", result: turnOffResult }],
    });

    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("rejects a configured failure", async () => {
    const provider = new MockTranslationProvider({
      attempts: [{ type: "failure", message: "Mock provider unavailable." }],
    });

    await expect(provider.translate(request)).rejects.toThrow(
      "Mock provider unavailable.",
    );
  });

  it("models retry with a failure followed by success", async () => {
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "failure", message: "First attempt failed." },
        { type: "success", result: turnOffResult },
      ],
    });

    await expect(provider.translate(request)).rejects.toThrow(
      "First attempt failed.",
    );
    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
  });

  it("repeats the final configured attempt", async () => {
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "success", result: turnOffResult },
        { type: "success", result: switchOffResult },
      ],
    });

    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
  });
});
```

- [ ] **Step 2: Run the focused test and verify that it fails**

Run from `extension/`:

```bash
rtk npm test -- --run tests/mock-translation-provider.test.ts
```

Expected: FAIL because `../src/mock-translation-provider` does not exist.

- [ ] **Step 3: Implement immediate deterministic attempts**

Create `extension/src/mock-translation-provider.ts`:

```ts
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "./translation";

export type MockTranslationAttempt =
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

export interface MockTranslationProviderOptions {
  readonly attempts: readonly [
    MockTranslationAttempt,
    ...MockTranslationAttempt[],
  ];
}

export class MockTranslationProvider implements TranslationProvider {
  private attemptIndex = 0;

  public constructor(
    private readonly options: MockTranslationProviderOptions,
  ) {}

  public translate(_request: TranslationRequest): Promise<TranslationResult> {
    const attemptIndex = Math.min(
      this.attemptIndex,
      this.options.attempts.length - 1,
    );
    const attempt =
      this.options.attempts[attemptIndex] ?? this.options.attempts[0];
    this.attemptIndex += 1;

    return attempt.type === "success"
      ? Promise.resolve(attempt.result)
      : Promise.reject(new Error(attempt.message));
  }
}
```

- [ ] **Step 4: Run focused and static checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/mock-translation-provider.test.ts
rtk npm run format
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 5: Commit deterministic immediate scenarios**

```bash
rtk git add extension/src/mock-translation-provider.ts extension/tests/mock-translation-provider.test.ts
rtk git commit -m "feat(extension): add deterministic mock translation outcomes"
```

---

### Task 3: Delay, Cancellation, Concurrency, and Full Verification

**Files:**

- Modify: `extension/src/mock-translation-provider.ts`
- Modify: `extension/tests/mock-translation-provider.test.ts`

**Interfaces:**

- Consumes: `TranslationOptions.signal?: AbortSignal` and `MockTranslationAttempt.delayMs?: number`.
- Preserves: all interfaces produced by Tasks 1 and 2.
- Produces: delayed outcomes and `AbortError` cancellation with deterministic attempt consumption.

- [ ] **Step 1: Add fake-timer lifecycle hooks**

Update the Vitest import and add cleanup in `extension/tests/mock-translation-provider.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
```

Remove the explicit `fetchSpy.mockRestore()` from the immediate success test because `afterEach` now owns cleanup.

- [ ] **Step 2: Add failing delay and invocation-order tests**

Append:

```ts
describe("MockTranslationProvider timing", () => {
  it("settles a successful attempt only after its configured delay", async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [{ type: "success", result: turnOffResult, delayMs: 500 }],
    });
    let settled = false;
    const translation = provider.translate(request).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(translation).resolves.toBe(turnOffResult);
  });

  it("rejects a failure only after its configured delay", async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "failure", message: "Delayed failure.", delayMs: 250 },
      ],
    });
    let settled = false;
    const translation = provider.translate(request);
    void translation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(translation).rejects.toThrow("Delayed failure.");
  });

  it("assigns concurrent calls by invocation order", async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "success", result: turnOffResult, delayMs: 100 },
        { type: "success", result: switchOffResult },
      ],
    });

    const first = provider.translate(request);
    const second = provider.translate(request);

    await expect(second).resolves.toBe(switchOffResult);
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(turnOffResult);
  });
});
```

- [ ] **Step 3: Add failing cancellation tests**

Append:

```ts
describe("MockTranslationProvider cancellation", () => {
  it("rejects a pre-aborted call without consuming an attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "success", result: turnOffResult },
        { type: "success", result: switchOffResult },
      ],
    });

    await expect(
      provider.translate(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(provider.translate(request)).resolves.toBe(turnOffResult);
  });

  it("cancels a delayed attempt and advances a later retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    const provider = new MockTranslationProvider({
      attempts: [
        { type: "success", result: turnOffResult, delayMs: 500 },
        { type: "success", result: switchOffResult },
      ],
    });

    const translation = provider.translate(request, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(translation).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
    await expect(provider.translate(request)).resolves.toBe(switchOffResult);
  });

  it("ignores abort after a delayed attempt has settled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const provider = new MockTranslationProvider({
      attempts: [{ type: "success", result: turnOffResult, delayMs: 10 }],
    });

    const translation = provider.translate(request, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(translation).resolves.toBe(turnOffResult);

    controller.abort();
    await expect(translation).resolves.toBe(turnOffResult);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 4: Run the focused test and verify the new cases fail**

Run from `extension/`:

```bash
rtk npm test -- --run tests/mock-translation-provider.test.ts
```

Expected: delay tests settle immediately, and cancellation tests fail because the provider ignores `delayMs` and `signal`.

- [ ] **Step 5: Implement delay and cancellation**

Replace `MockTranslationProvider.translate` and add the helpers below in `extension/src/mock-translation-provider.ts`:

```ts
  public translate(
    _request: TranslationRequest,
    options: TranslationOptions = {},
  ): Promise<TranslationResult> {
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
          signal.removeEventListener("abort", abortListener);
          abortListener = undefined;
        }
      };

      abortListener = (): void => {
        cleanup();
        reject(createAbortError());
      };

      signal?.addEventListener("abort", abortListener, { once: true });
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
  return attempt.type === "success"
    ? Promise.resolve(attempt.result)
    : Promise.reject(new Error(attempt.message));
}

function createAbortError(): DOMException {
  return new DOMException("Translation request was aborted.", "AbortError");
}
```

Add `TranslationOptions` to the type-only import from `./translation`.

- [ ] **Step 6: Run focused checks**

Run from `extension/`:

```bash
rtk npm test -- --run tests/translation.test.ts tests/mock-translation-provider.test.ts
rtk npm run format
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
```

Expected: all checks pass.

- [ ] **Step 7: Run the complete extension verification**

Run from `extension/`:

```bash
rtk npm run check
```

Expected: formatting, linting, strict type-checking, all Vitest tests, and the Safari 15.4/iOS 15.4 production build pass. The build output remains limited to the existing content bundle and manifest; there is no translation UI or runtime wiring change.

- [ ] **Step 8: Review the final diff for scope**

Run from the repository root:

```bash
rtk git status --short
rtk git diff --check
rtk git diff -- extension/src/translation.ts extension/src/mock-translation-provider.ts extension/tests/translation.test.ts extension/tests/mock-translation-provider.test.ts
```

Expected: only the planned translation source/test files are uncommitted, with no `content.ts`, manifest, dependency, backend, UI, or Xcode changes.

- [ ] **Step 9: Commit complete mock async behavior**

```bash
rtk git add extension/src/mock-translation-provider.ts extension/tests/mock-translation-provider.test.ts
rtk git commit -m "feat(extension): support mock translation lifecycle"
```
