import { extractTextContext } from './context-extraction';
import { findTextHitAtPoint } from './hit-testing';
import { isEligibleTextTarget } from './target-eligibility';
import { findFocusBlock } from './text-snapshot';
import type { DetectionContext } from './context-extraction';
import type { ViewportPoint, ViewportRect } from './hit-testing';

export type {
  ContextBlock,
  DetectionContext,
  FocusContextBlock,
} from './context-extraction';
export type { ViewportPoint, ViewportRect } from './hit-testing';

export interface DetectionInput {
  readonly point: ViewportPoint;
  readonly target: EventTarget | null;
  readonly eventPath: readonly EventTarget[];
}

export interface DetectionResult {
  readonly anchorRect: ViewportRect;
  readonly context: DetectionContext;
}

export function detectEnglishContext(
  input: DetectionInput,
  documentRoot: Document = document,
): DetectionResult | null {
  try {
    const hit = findTextHitAtPoint(input.point, documentRoot);
    if (hit === null) {
      return null;
    }

    const focusBlock = findFocusBlock(hit.textNode);
    if (focusBlock === null) {
      return null;
    }

    if (
      !isEligibleTextTarget(hit.textNode, focusBlock, {
        target: input.target,
        eventPath: input.eventPath,
      })
    ) {
      return null;
    }

    const context = extractTextContext(hit, focusBlock);
    return context === null ? null : { anchorRect: hit.anchorRect, context };
  } catch {
    return null;
  }
}
