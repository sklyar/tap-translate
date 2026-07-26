// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTextSnapshot,
  findFocusBlock,
  findReadingRegion,
} from '../src/text-snapshot';

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

describe('logical block resolution', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['paragraph inside list item', '<li><p id="focus">Target</p></li>', 'P'],
    [
      'paragraph inside quotation',
      '<blockquote><p id="focus">Target</p></blockquote>',
      'P',
    ],
    [
      'direct list text',
      '<li id="focus">Target<ul><li>Nested</li></ul></li>',
      'LI',
    ],
    ['heading', '<h2 id="focus"><span>Target</span></h2>', 'H2'],
    [
      'table cell',
      '<table><tbody><tr><td id="focus">Target</td></tr></tbody></table>',
      'TD',
    ],
    [
      'generic block fallback',
      '<div id="focus"><span>Target</span></div>',
      'DIV',
    ],
  ])('chooses the nearest logical block for %s', (_name, html, tagName) => {
    document.body.innerHTML = html;
    expect(
      findFocusBlock(requiredText(requiredElement('#focus')))?.tagName,
    ).toBe(tagName);
  });

  it('does not use body as a focus block', () => {
    document.body.textContent = 'Target';
    const textNode = document.body.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error('Missing body text');
    }
    expect(findFocusBlock(textNode)).toBeNull();
  });

  it.each(['aside', 'nav', 'header', 'footer', 'section', 'article', 'main'])(
    'uses the nearest %s as the reading region',
    (tagName) => {
      document.body.innerHTML = `<${tagName} id="region"><div><p id="focus">Target</p></div></${tagName}>`;
      expect(findReadingRegion(requiredElement('#focus'))?.id).toBe('region');
    },
  );
});

describe('buildTextSnapshot', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('normalizes nested inline text and maps the clicked source offset', () => {
    document.body.innerHTML =
      '<p id="focus">  Hello <strong>brave</strong> world.<br><em>Next</em></p>';
    const root = requiredElement('#focus');
    const textNode = requiredText(requiredElement('strong'));

    expect(buildTextSnapshot(root, { textNode, offset: 2 })).toEqual({
      text: 'Hello brave world.\nNext',
      sourceOffset: 8,
    });
  });

  it('keeps a word split only by inline styling contiguous', () => {
    document.body.innerHTML =
      '<p id="focus"><span>t</span><strong>ur</strong><em>n</em></p>';
    const root = requiredElement('#focus');
    const textNode = requiredText(requiredElement('strong'));
    expect(buildTextSnapshot(root, { textNode, offset: 1 })).toEqual({
      text: 'turn',
      sourceOffset: 2,
    });
  });

  it('keeps visible inline link text but prunes nested logical blocks', () => {
    document.body.innerHTML =
      '<li id="focus">Read <a href="/term">this</a> now<ul><li>Nested</li></ul></li>';
    expect(buildTextSnapshot(requiredElement('#focus'), null)?.text).toBe(
      'Read this now',
    );
  });

  it('keeps a word boundary around a pruned nested logical block', () => {
    document.body.innerHTML =
      '<li id="focus">Hello<p>Nested paragraph.</p>world</li>';

    expect(buildTextSnapshot(requiredElement('#focus'), null)?.text).toBe(
      'Hello world',
    );
  });

  it('collapses source whitespace, preserves consecutive br elements, and trims edges', () => {
    document.body.innerHTML =
      '<p id="focus">  One \n <span>two</span><br><br>Three  </p>';
    expect(buildTextSnapshot(requiredElement('#focus'), null)).toEqual({
      text: 'One two\n\nThree',
      sourceOffset: null,
    });
  });

  it('prunes hidden and unsupported descendants', () => {
    document.body.innerHTML =
      '<p id="focus">Visible <span hidden>Hidden</span><code>Code</code>end</p>';
    expect(buildTextSnapshot(requiredElement('#focus'), null)?.text).toBe(
      'Visible end',
    );
  });

  it('returns null for an invalid or detached source position', () => {
    document.body.innerHTML = '<p id="focus">Target</p>';
    const root = requiredElement('#focus');
    const textNode = requiredText(root);
    const detached = document.createTextNode('Detached');
    expect(buildTextSnapshot(root, { textNode, offset: 6 })).toBeNull();
    expect(
      buildTextSnapshot(root, { textNode: detached, offset: 0 }),
    ).toBeNull();
  });

  it('returns null when a block has no eligible text', () => {
    document.body.innerHTML = '<p id="focus"><code>return</code></p>';
    expect(buildTextSnapshot(requiredElement('#focus'), null)).toBeNull();
  });
});
