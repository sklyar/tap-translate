import { findTextHitAtPoint } from './hit-testing';
import { getEnglishWordAtOffset } from './word-segmentation';

function handleClick(event: MouseEvent): void {
  const hit = findTextHitAtPoint({
    clientX: event.clientX,
    clientY: event.clientY,
  });
  const word =
    hit === null
      ? null
      : getEnglishWordAtOffset(hit.textNode.data, hit.characterOffset);

  if (word !== null) {
    console.log('[TapTranslate] Detected word:', word);
  }
}

document.addEventListener('click', handleClick, {
  capture: true,
  passive: true,
});
