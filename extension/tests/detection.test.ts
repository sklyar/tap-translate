// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectEnglishContext } from '../src/detection';
import {
  setCaretPositionFromPoint,
  stubCharacterRectangles,
  TEST_RECT,
} from './dom-test-helpers';

const requiredElement = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
};

const requiredText = (root: Element): Text => {
  const textNode = root.firstChild;
  if (!(textNode instanceof Text)) {
    throw new Error('Missing fixture text node');
  }
  return textNode;
};

describe('detectEnglishContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
    document.body.replaceChildren();
  });

  it('returns a complete serializable detection result', () => {
    document.body.innerHTML = `
      <article>
        <p>Previous context.</p>
        <p id="focus">Turn the <strong>light</strong> off.</p>
        <p>Next context.</p>
      </article>
    `;
    const target = requiredElement('strong');
    const textNode = requiredText(target);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));

    const result = detectEnglishContext(
      {
        point: { clientX: 15, clientY: 15 },
        target,
        eventPath: [target, requiredElement('#focus'), document.body, document],
      },
      document,
    );

    expect(result?.context.focusBlock.text).toBe('Turn the light off.');
    expect(result?.context.focusBlock.word).toEqual({ start: 9, end: 14 });
    expect(result?.anchorRect).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 10,
    });
    expect(JSON.parse(JSON.stringify(result)) as unknown).toEqual(result);
  });

  it('returns null when hit-testing fails', () => {
    expect(
      detectEnglishContext(
        {
          point: { clientX: Number.NaN, clientY: 15 },
          target: null,
          eventPath: [],
        },
        document,
      ),
    ).toBeNull();
  });

  it('returns null when body would be the only focus block', () => {
    const textNode = document.createTextNode('Target');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
    expect(
      detectEnglishContext(
        {
          point: { clientX: 15, clientY: 15 },
          target: document.body,
          eventPath: [document.body, document, window],
        },
        document,
      ),
    ).toBeNull();
  });

  it('returns null when the event path identifies an overlay button', () => {
    document.body.innerHTML =
      '<p id="focus">Target</p><button id="overlay">Overlay</button>';
    const textNode = requiredText(requiredElement('#focus'));
    const overlay = requiredElement('#overlay');
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
    expect(
      detectEnglishContext(
        {
          point: { clientX: 15, clientY: 15 },
          target: overlay,
          eventPath: [overlay, document.body, document, window],
        },
        document,
      ),
    ).toBeNull();
  });

  it('returns null for hidden target text', () => {
    document.body.innerHTML = '<p id="focus" hidden>Target</p>';
    const focus = requiredElement('#focus');
    const textNode = requiredText(focus);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
    expect(
      detectEnglishContext(
        {
          point: { clientX: 15, clientY: 15 },
          target: focus,
          eventPath: [focus, document.body, document, window],
        },
        document,
      ),
    ).toBeNull();
  });

  it('returns null when context contains no accepted English word', () => {
    document.body.innerHTML = '<p id="focus">123</p>';
    const focus = requiredElement('#focus');
    const textNode = requiredText(focus);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));
    expect(
      detectEnglishContext(
        {
          point: { clientX: 15, clientY: 15 },
          target: focus,
          eventPath: [focus, document.body, document, window],
        },
        document,
      ),
    ).toBeNull();
  });
});
