// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { findTextHitAtPoint } from '../src/hit-testing';
import {
  setCaretPositionFromPoint,
  setCaretRangeFromPoint,
  stubCharacterRectangles,
  TEST_RECT,
} from './dom-test-helpers';

describe('findTextHitAtPoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
    document.body.replaceChildren();
  });

  it('prefers caretPositionFromPoint and returns the matched character rectangle', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(document, new Map([[1, [TEST_RECT]]]));

    expect(findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)).toEqual({
      textNode,
      characterOffset: 1,
      anchorRect: { x: 10, y: 10, width: 10, height: 10 },
    });
  });

  it('uses caretRangeFromPoint only when the standard API is unavailable', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretRangeFromPoint(document, textNode, 2);
    stubCharacterRectangles(document, new Map([[2, [TEST_RECT]]]));

    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document)
        ?.characterOffset,
    ).toBe(2);
  });

  it('does not fall back when caretPositionFromPoint returns null', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, null);
    setCaretRangeFromPoint(document, textNode, 2);

    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null when adjacent characters both contain the point', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(
      document,
      new Map([
        [0, [TEST_RECT]],
        [1, [TEST_RECT]],
      ]),
    );

    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('assigns a shared character edge to the character on the right', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    const rightRect = {
      ...TEST_RECT,
      x: 20,
      left: 20,
      right: 30,
    };
    stubCharacterRectangles(
      document,
      new Map([
        [0, [TEST_RECT]],
        [1, [rightRect]],
      ]),
    );

    expect(findTextHitAtPoint({ clientX: 20, clientY: 15 }, document)).toEqual({
      textNode,
      characterOffset: 1,
      anchorRect: { x: 20, y: 10, width: 10, height: 10 },
    });
  });

  it('returns null for a non-text caret node', () => {
    setCaretPositionFromPoint(document, {
      offsetNode: document.body,
      offset: 0,
    });
    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null for an invalid caret offset', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 6 });
    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null for zero-size geometry', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    stubCharacterRectangles(
      document,
      new Map([[1, [{ ...TEST_RECT, width: 0 }]]]),
    );
    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null for a non-finite point', () => {
    expect(
      findTextHitAtPoint({ clientX: Number.NaN, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null when the caret API throws', () => {
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => {
        throw new DOMException('mutated');
      },
    });
    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });

  it('returns null when Range creation throws', () => {
    const textNode = document.createTextNode('Hello');
    document.body.replaceChildren(textNode);
    setCaretPositionFromPoint(document, { offsetNode: textNode, offset: 1 });
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      throw new DOMException('mutated');
    });
    expect(
      findTextHitAtPoint({ clientX: 15, clientY: 15 }, document),
    ).toBeNull();
  });
});
