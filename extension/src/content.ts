import { findEnglishWordAtPoint } from './hit-testing';

function handleClick(event: MouseEvent): void {
  const word = findEnglishWordAtPoint({
    clientX: event.clientX,
    clientY: event.clientY,
  });

  if (word !== null) {
    console.log('[TapTranslate] Detected word:', word);
  }
}

document.addEventListener('click', handleClick, {
  capture: true,
  passive: true,
});
