// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showAcceptedHitEffect } from '../src/accepted-hit-effect';

const effectSelector = '[data-taptranslate-hit-effect]';

const requiredEffect = (): HTMLElement => {
  const effect = document.querySelector(effectSelector);
  if (!(effect instanceof HTMLElement)) {
    throw new Error('Missing accepted-hit effect');
  }
  return effect;
};

describe('showAcceptedHitEffect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    });
  });

  afterEach(() => {
    document.querySelectorAll(effectSelector).forEach((effect) => {
      effect.remove();
    });
    Reflect.deleteProperty(window, 'requestAnimationFrame');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders a noninteractive ring centered on the accepted character', () => {
    showAcceptedHitEffect({ x: 10, y: 20, width: 8, height: 16 }, document);

    const effect = requiredEffect();
    expect(effect.getAttribute('aria-hidden')).toBe('true');
    expect(effect.textContent).toBe('');
    expect(effect.style.position).toBe('fixed');
    expect(effect.style.left).toBe('14px');
    expect(effect.style.top).toBe('28px');
    expect(effect.style.pointerEvents).toBe('none');
    expect(effect.style.zIndex).toBe('2147483647');
    expect(effect.style.transform).toBe('translate(-50%, -50%) scale(1.8)');
    expect(effect.style.opacity).toBe('0');
    expect(effect.style.getPropertyPriority('pointer-events')).toBe(
      'important',
    );
  });

  it('removes the ring after the animation timeout', () => {
    showAcceptedHitEffect({ x: 10, y: 20, width: 8, height: 16 }, document);

    vi.advanceTimersByTime(549);
    expect(document.querySelector(effectSelector)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector(effectSelector)).toBeNull();
  });

  it.each([
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: -1 },
  ])('does not render invalid geometry: %o', (rect) => {
    showAcceptedHitEffect(rect, document);
    expect(document.querySelector(effectSelector)).toBeNull();
  });
});
