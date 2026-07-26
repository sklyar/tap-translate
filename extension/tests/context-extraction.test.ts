// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractTextContext,
  type ContextLimits,
  type DetectionContext,
} from '../src/context-extraction';

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

const extractFixtureContext = (
  selector: string,
  word: string,
  limits?: ContextLimits,
): DetectionContext | null => {
  const focusBlock = requiredElement(selector);
  const walker = document.createTreeWalker(focusBlock, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node instanceof Text && !node.data.includes(word)) {
    node = walker.nextNode();
  }

  if (!(node instanceof Text)) {
    throw new Error(`Fixture word not found: ${word}`);
  }

  const hit = {
    textNode: node,
    characterOffset: node.data.indexOf(word) + 1,
    anchorRect,
  };

  return limits === undefined
    ? extractTextContext(hit, focusBlock)
    : extractTextContext(hit, focusBlock, limits);
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

  it('collects one previous and one next block in DOM reading order', () => {
    document.body.innerHTML = `
      <article>
        <p>Previous paragraph.</p>
        <p id="focus">Click the target word.</p>
        <p>Next paragraph.</p>
        <p>Too far away.</p>
      </article>
    `;

    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks).toEqual([
      {
        text: 'Previous paragraph.',
        truncatedBefore: false,
        truncatedAfter: false,
      },
    ]);
    expect(result?.afterBlocks).toEqual([
      {
        text: 'Next paragraph.',
        truncatedBefore: false,
        truncatedAfter: false,
      },
    ]);
  });

  it('does not cross into a nested aside or another section', () => {
    document.body.innerHTML = `
      <article>
        <p>Previous article text.</p>
        <aside><p>Aside text.</p></aside>
        <p id="focus">Click the target word.</p>
        <section><p>Other section text.</p></section>
        <p>Next article text.</p>
      </article>
    `;
    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks[0]?.text).toBe('Previous article text.');
    expect(result?.afterBlocks[0]?.text).toBe('Next article text.');
  });

  it('keeps the previous suffix and next prefix at the neighbor limit', () => {
    document.body.innerHTML = `
      <article>
        <p>xxx😀near</p>
        <p id="focus">Click the target word.</p>
        <p>near😀xxx</p>
      </article>
    `;
    const result = extractFixtureContext('#focus', 'target', {
      focusBlockCharacters: 40,
      neighborBlockCharacters: 5,
    });
    expect(result?.beforeBlocks).toEqual([
      { text: 'near', truncatedBefore: true, truncatedAfter: false },
    ]);
    expect(result?.afterBlocks).toEqual([
      { text: 'near', truncatedBefore: false, truncatedAfter: true },
    ]);
  });

  it('skips hidden, code-only, and empty candidate blocks', () => {
    document.body.innerHTML = `
      <article>
        <p>Previous visible.</p>
        <p hidden>Hidden.</p>
        <p><code>return</code></p>
        <p></p>
        <p id="focus">Click the target word.</p>
        <p>Next visible.</p>
      </article>
    `;
    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks[0]?.text).toBe('Previous visible.');
    expect(result?.afterBlocks[0]?.text).toBe('Next visible.');
  });

  it('collects no neighbors when the fallback parent is body', () => {
    document.body.innerHTML = `
      <p>Previous.</p>
      <p id="focus">Click the target word.</p>
      <p>Next.</p>
    `;
    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks).toEqual([]);
    expect(result?.afterBlocks).toEqual([]);
  });

  it('keeps a nested list item separate from its parent list item', () => {
    document.body.innerHTML = `
      <section>
        <ul>
          <li>Parent text<ul><li>Nested text.</li></ul></li>
          <li id="focus">Click the target word.</li>
        </ul>
      </section>
    `;
    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks[0]?.text).toBe('Nested text.');
  });

  it('uses an empty array for a missing side', () => {
    document.body.innerHTML = `
      <article>
        <p id="focus">Click the target word.</p>
        <p>Only next text.</p>
      </article>
    `;
    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks).toEqual([]);
    expect(result?.afterBlocks[0]?.text).toBe('Only next text.');
  });

  it('does not use a containing logical block as a neighbor', () => {
    document.body.innerHTML = `
      <article>
        Direct text before.
        <p id="focus">Click the target word.</p>
        Direct text after.
      </article>
    `;

    const result = extractFixtureContext('#focus', 'target');
    expect(result?.beforeBlocks).toEqual([]);
    expect(result?.afterBlocks).toEqual([]);
  });
});
