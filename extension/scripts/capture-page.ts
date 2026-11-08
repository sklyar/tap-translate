// Runs inside the captured page. Vite bundles this file into an IIFE, and
// capture-contexts.ts injects it before the page scripts. A trusted click goes
// through the same detection code as the content script.
import { detectEnglishContext } from '../src/detection';
import type { DetectionContext } from '../src/detection';

export interface CaptureState {
  readonly context: DetectionContext | null;
}

declare global {
  interface Window {
    tapTranslateCapture?: CaptureState;
  }
}

document.addEventListener(
  'click',
  (event) => {
    const result = detectEnglishContext(
      {
        point: { clientX: event.clientX, clientY: event.clientY },
        target: event.target,
        eventPath: event.composedPath(),
      },
      document,
    );

    window.tapTranslateCapture = { context: result?.context ?? null };

    // Unlike the content script, the capture must not let a click on a link
    // navigate away: the next samples use the same page.
    event.preventDefault();
  },
  { capture: true },
);
