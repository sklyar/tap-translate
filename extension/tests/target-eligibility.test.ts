// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  isEligibleTextTarget,
  isVisibleContextText,
} from '../src/target-eligibility';

const firstTextNode = (root: Element): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text;
};

const eventPathFrom = (target: Element): EventTarget[] => {
  const path: EventTarget[] = [];
  for (
    let current: Element | null = target;
    current !== null;
    current = current.parentElement
  ) {
    path.push(current);
  }
  return [...path, document, window];
};

const requiredElement = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`Missing fixture element: ${selector}`);
  }
  return element;
};

const requiredClosest = (element: Element, selector: string): Element => {
  const match = element.closest(selector);
  if (match === null) {
    throw new Error(`Missing fixture ancestor: ${selector}`);
  }
  return match;
};

describe('isEligibleTextTarget', () => {
  afterEach(() => {
    document.body.removeAttribute('onclick');
    document.body.replaceChildren();
  });

  it.each([
    ['link with href', '<p><a href="/next">linked word</a></p>', 'a'],
    ['button', '<p><button>button word</button></p>', 'button'],
    ['label', '<p><label>label word</label></p>', 'label'],
    [
      'summary',
      '<details><summary>summary word</summary></details>',
      'summary',
    ],
    ['editable text', '<p contenteditable="true">editable word</p>', 'p'],
    ['ARIA button', '<p><span role="button">ARIA word</span></p>', 'span'],
    [
      'focusable widget',
      '<p><span tabindex="0">focusable word</span></p>',
      'span',
    ],
    [
      'inline handler',
      '<p><span onclick="void 0">handled word</span></p>',
      'span',
    ],
    ['hidden ancestor', '<p hidden>hidden word</p>', 'p'],
    ['ARIA-hidden ancestor', '<p aria-hidden="true">hidden word</p>', 'p'],
    ['display none', '<p style="display: none">hidden word</p>', 'p'],
    ['code', '<p><code>return word</code></p>', 'code'],
  ])('rejects %s', (_name, html, selector) => {
    document.body.innerHTML = html;
    const target = requiredElement(selector);
    const textNode = firstTextNode(target);
    const focusBlock =
      target.closest('p, li, blockquote, h1, h2, h3') ?? target;
    expect(
      isEligibleTextTarget(textNode, focusBlock, {
        target,
        eventPath: eventPathFrom(target),
      }),
    ).toBe(false);
  });

  it.each([
    ['plain formatted text', '<p><strong>plain word</strong></p>', 'strong'],
    ['anchor without href', '<p><a>anchor word</a></p>', 'a'],
    [
      'pointer styling only',
      '<p><span style="cursor: pointer">glossary word</span></p>',
      'span',
    ],
  ])('accepts %s', (_name, html, selector) => {
    document.body.innerHTML = html;
    const target = requiredElement(selector);
    const focusBlock = requiredClosest(target, 'p');
    expect(
      isEligibleTextTarget(firstTextNode(target), focusBlock, {
        target,
        eventPath: eventPathFrom(target),
      }),
    ).toBe(true);
  });

  it('ignores a delegated body onclick outside the focus block', () => {
    document.body.setAttribute('onclick', 'void 0');
    document.body.innerHTML += '<p id="focus"><span>plain word</span></p>';
    const target = requiredElement('#focus span');
    expect(
      isEligibleTextTarget(firstTextNode(target), requiredElement('#focus'), {
        target,
        eventPath: eventPathFrom(target),
      }),
    ).toBe(true);
  });

  it('keeps visible link text for context but rejects it as the click target', () => {
    document.body.innerHTML =
      '<p id="focus">Read <a href="/term">this term</a> now.</p>';
    const target = requiredElement('a');
    const textNode = firstTextNode(target);
    expect(isVisibleContextText(textNode)).toBe(true);
    expect(
      isEligibleTextTarget(textNode, requiredElement('#focus'), {
        target,
        eventPath: eventPathFrom(target),
      }),
    ).toBe(false);
  });

  it('rejects an overlay button from the event path', () => {
    document.body.innerHTML =
      '<p id="focus">plain word</p><button id="overlay">Overlay</button>';
    const focusBlock = requiredElement('#focus');
    const overlay = requiredElement('#overlay');
    expect(
      isEligibleTextTarget(firstTextNode(focusBlock), focusBlock, {
        target: overlay,
        eventPath: eventPathFrom(overlay),
      }),
    ).toBe(false);
  });
});

describe('isVisibleContextText', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['hidden', '<p hidden>hidden word</p>', 'p'],
    ['editable', '<p contenteditable="true">editable word</p>', 'p'],
    [
      'form control',
      '<select><option>hidden option</option></select>',
      'option',
    ],
    ['preformatted', '<pre>preformatted word</pre>', 'pre'],
  ])('excludes %s text', (_name, html, selector) => {
    document.body.innerHTML = html;
    expect(isVisibleContextText(firstTextNode(requiredElement(selector)))).toBe(
      false,
    );
  });
});
