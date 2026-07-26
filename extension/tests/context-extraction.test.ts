// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { extractTextContext } from '../src/context-extraction';

const anchorRect = { x: 10, y: 10, width: 8, height: 16 } as const;

const requiredElement = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
};

const requiredText = (root: Element): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode();
  if (!(textNode instanceof Text)) {
    throw new Error('Missing fixture text node');
  }
  return textNode;
};

describe('extractTextContext', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('returns word and sentence spans inside normalized focus text', () => {
    document.body.innerHTML =
      '<p id="focus">Before. Turn the <strong>light</strong> off. After.</p>';
    const focusBlock = requiredElement('#focus');
    const textNode = requiredText(requiredElement('strong'));

    expect(
      extractTextContext(
        { textNode, characterOffset: 1, anchorRect },
        focusBlock,
      ),
    ).toEqual({
      beforeBlocks: [],
      focusBlock: {
        text: 'Before. Turn the light off. After.',
        word: { start: 17, end: 22 },
        sentence: { start: 8, end: 27 },
        truncatedBefore: false,
        truncatedAfter: false,
      },
      afterBlocks: [],
    });
  });

  it('detects a contraction split across inline nodes', () => {
    document.body.innerHTML =
      '<p id="focus">I <span>ca</span><em>n\'t</em> wait.</p>';
    const focusBlock = requiredElement('#focus');
    const textNode = requiredText(requiredElement('span'));
    const result = extractTextContext(
      { textNode, characterOffset: 1, anchorRect },
      focusBlock,
    );
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }
    expect(
      result.focusBlock.text.slice(
        result.focusBlock.word.start,
        result.focusBlock.word.end,
      ),
    ).toBe("can't");
  });

  it.each([
    ['punctuation', 'Hello, world.', 5],
    ['number', 'Version 123.', 8],
    ['alphanumeric token', 'Version abc123.', 9],
    ['non-Latin text', 'Привет мир.', 0],
  ])('rejects %s', (_name, text, characterOffset) => {
    const textNode = document.createTextNode(text);
    const focusBlock = document.createElement('p');
    focusBlock.append(textNode);
    document.body.replaceChildren(focusBlock);
    expect(
      extractTextContext({ textNode, characterOffset, anchorRect }, focusBlock),
    ).toBeNull();
  });

  it('crops around the complete sentence and rebases both spans', () => {
    document.body.innerHTML =
      '<p id="focus">Long prefix words. Target sentence. Long suffix words.</p>';
    const focusBlock = requiredElement('#focus');
    const textNode = requiredText(focusBlock);
    const result = extractTextContext(
      {
        textNode,
        characterOffset: textNode.data.indexOf('Target') + 1,
        anchorRect,
      },
      focusBlock,
      { focusBlockCharacters: 24, neighborBlockCharacters: 8 },
    );
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }
    expect(result.focusBlock.text.length).toBeLessThanOrEqual(24);
    expect(
      result.focusBlock.text.slice(
        result.focusBlock.sentence.start,
        result.focusBlock.sentence.end,
      ),
    ).toBe('Target sentence.');
    expect(
      result.focusBlock.text.slice(
        result.focusBlock.word.start,
        result.focusBlock.word.end,
      ),
    ).toBe('Target');
    expect(result.focusBlock.truncatedBefore).toBe(true);
    expect(result.focusBlock.truncatedAfter).toBe(true);
  });

  it('returns null when the sentence alone exceeds the focus limit', () => {
    const textNode = document.createTextNode(
      'This sentence is longer than ten.',
    );
    const focusBlock = document.createElement('p');
    focusBlock.append(textNode);
    document.body.replaceChildren(focusBlock);
    expect(
      extractTextContext(
        { textNode, characterOffset: 1, anchorRect },
        focusBlock,
        { focusBlockCharacters: 10, neighborBlockCharacters: 4 },
      ),
    ).toBeNull();
  });

  it('does not leave unpaired surrogates at crop boundaries', () => {
    document.body.innerHTML = '<p id="focus">😀😀. Target. 😀😀</p>';
    const focusBlock = requiredElement('#focus');
    const textNode = requiredText(focusBlock);
    const result = extractTextContext(
      {
        textNode,
        characterOffset: textNode.data.indexOf('Target') + 1,
        anchorRect,
      },
      focusBlock,
      { focusBlockCharacters: 12, neighborBlockCharacters: 4 },
    );
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }
    expect(result.focusBlock.text).not.toMatch(/^[\uDC00-\uDFFF]/u);
    expect(result.focusBlock.text).not.toMatch(/[\uD800-\uDBFF]$/u);
  });
});
