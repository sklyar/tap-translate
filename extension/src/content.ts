import { showAcceptedHitEffect } from './accepted-hit-effect';
import { detectEnglishContext } from './detection';

function handleClick(event: MouseEvent): void {
  try {
    const result = detectEnglishContext({
      point: {
        clientX: event.clientX,
        clientY: event.clientY,
      },
      target: event.target,
      eventPath: event.composedPath(),
    });

    if (result === null) {
      return;
    }

    showAcceptedHitEffect(result.anchorRect);

    const { text, word: wordSpan } = result.context.focusBlock;
    const word = text.slice(wordSpan.start, wordSpan.end);
    console.log('[TapTranslate] Detected word:', word);
  } catch {
    console.error('[TapTranslate] Unexpected detection failure.');
  }
}

document.addEventListener('click', handleClick, {
  capture: true,
  passive: true,
});
