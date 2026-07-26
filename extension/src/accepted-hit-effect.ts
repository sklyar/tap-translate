import type { ViewportRect } from './hit-testing';

const cleanupDelayMilliseconds = 550;

export function showAcceptedHitEffect(
  rect: ViewportRect,
  documentRoot: Document = document,
): void {
  if (!isValidRect(rect)) {
    return;
  }

  try {
    const ring = documentRoot.createElement('div');
    ring.setAttribute('data-taptranslate-hit-effect', '');
    ring.setAttribute('aria-hidden', 'true');

    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const styles = {
      all: 'initial',
      position: 'fixed',
      display: 'block',
      left: `${String(centerX)}px`,
      top: `${String(centerY)}px`,
      width: '24px',
      height: '24px',
      margin: '0',
      padding: '0',
      boxSizing: 'border-box',
      background: 'transparent',
      border: '2px solid #22c55e',
      borderRadius: '9999px',
      pointerEvents: 'none',
      zIndex: '2147483647',
      opacity: '1',
      transform: 'translate(-50%, -50%) scale(0.35)',
      transformOrigin: 'center',
      transition: 'transform 450ms ease-out, opacity 450ms ease-out',
    } as const;

    for (const [property, value] of Object.entries(styles)) {
      ring.style.setProperty(toKebabCase(property), value, 'important');
    }

    documentRoot.documentElement.append(ring);
    globalThis.setTimeout(() => {
      ring.remove();
    }, cleanupDelayMilliseconds);

    // Commit the initial scale before changing it on the next frame.
    ring.getBoundingClientRect();

    const animate = (): void => {
      ring.style.setProperty(
        'transform',
        'translate(-50%, -50%) scale(1.8)',
        'important',
      );
      ring.style.setProperty('opacity', '0', 'important');
    };

    const view = documentRoot.defaultView;
    if (view === null) {
      animate();
    } else {
      view.requestAnimationFrame(animate);
    }
  } catch {
    // Debug rendering is best effort and never affects the page.
  }
}

function isValidRect(rect: ViewportRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function toKebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
