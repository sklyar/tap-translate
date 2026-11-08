export interface InteractionMetadata {
  readonly target: EventTarget | null;
  readonly eventPath: readonly EventTarget[];
}

const interactiveTargetSelector = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  'label',
  'summary',
  'audio[controls]',
  'video[controls]',
].join(',');

const excludedTargetSelector = 'script,style,template,canvas,svg,code,pre';
// Inline code stays in the context text: without it, "run <code>gofmt</code>;"
// becomes "run ;", and the model gets a broken sentence.
const excludedContextSelector = 'script,style,template,canvas,svg,pre';
const excludedContextControlSelector =
  'input,select,textarea,option,audio[controls],video[controls]';
// A footnote reference such as <sup>[54]</sup> or <sup>[citation needed]</sup>.
const footnoteReferenceText = /^\s*\[[^[\]]*\]\s*$/;

const interactiveRoles = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

export function isEligibleTextTarget(
  textNode: Text,
  focusBlock: Element,
  interaction: InteractionMetadata,
): boolean {
  const textParent = textNode.parentElement;
  const eventTarget = eventTargetElement(interaction.target);

  if (
    textParent === null ||
    eventTarget === null ||
    !focusBlock.contains(textNode) ||
    !focusBlock.contains(eventTarget)
  ) {
    return false;
  }

  if (
    isInsideEditableContent(textParent) ||
    isInsideEditableContent(eventTarget) ||
    ancestryBelowBody(textParent).some(isHardRejectedTarget) ||
    eventPathElements(interaction.eventPath).some(isHardRejectedTarget)
  ) {
    return false;
  }

  for (const element of eventPathElements(interaction.eventPath)) {
    if (hasNonNegativeTabIndex(element) || hasClickHandler(element)) {
      return false;
    }

    if (element === focusBlock) {
      break;
    }
  }

  return true;
}

export function isVisibleContextText(textNode: Text): boolean {
  const textParent = textNode.parentElement;

  return textParent !== null && isVisibleContextElement(textParent);
}

export function isVisibleContextElement(element: Element): boolean {
  if (isInsideEditableContent(element)) {
    return false;
  }

  return !ancestryBelowBody(element).some(
    (ancestor) =>
      isHidden(ancestor) ||
      ancestor.matches(excludedContextSelector) ||
      ancestor.matches(excludedContextControlSelector) ||
      isFootnoteReference(ancestor),
  );
}

// Footnote references are noise for the translation. They also move sentence
// boundaries: Intl.Segmenter splits "end.[54] Next" after the "[", so the next
// sentence starts with "54]".
function isFootnoteReference(element: Element): boolean {
  return (
    element.matches('sup') && footnoteReferenceText.test(element.textContent)
  );
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  return target instanceof Node ? target.parentElement : null;
}

function eventPathElements(path: readonly EventTarget[]): readonly Element[] {
  const elements: Element[] = [];

  for (const target of path) {
    if (target instanceof Element && target === target.ownerDocument.body) {
      break;
    }

    if (!(target instanceof Element)) {
      continue;
    }

    elements.push(target);
  }

  return elements;
}

function ancestryBelowBody(start: Element): readonly Element[] {
  const elements: Element[] = [];

  for (
    let element: Element | null = start;
    element !== null && element !== element.ownerDocument.body;
    element = element.parentElement
  ) {
    elements.push(element);
  }

  return elements;
}

function isHardRejectedTarget(element: Element): boolean {
  return (
    element.matches(interactiveTargetSelector) ||
    element.matches(excludedTargetSelector) ||
    hasInteractiveRole(element) ||
    isHidden(element)
  );
}

function hasInteractiveRole(element: Element): boolean {
  const role = element.getAttribute('role');

  return (
    role
      ?.toLowerCase()
      .split(/\s+/)
      .some((token) => interactiveRoles.has(token)) ?? false
  );
}

function isInsideEditableContent(start: Element): boolean {
  for (
    let element: Element | null = start;
    element !== null && element !== element.ownerDocument.body;
    element = element.parentElement
  ) {
    const contentEditable = element.getAttribute('contenteditable');

    if (contentEditable === null) {
      continue;
    }

    const value = contentEditable.trim().toLowerCase();
    return value === '' || value === 'true' || value === 'plaintext-only';
  }

  return false;
}

function hasClickHandler(element: Element): boolean {
  return (
    element.hasAttribute('onclick') ||
    ('onclick' in element && typeof element.onclick === 'function')
  );
}

function hasNonNegativeTabIndex(element: Element): boolean {
  const value = element.getAttribute('tabindex');
  // HTML parses tabindex with the rules for integers, so an empty or
  // non-numeric value is ignored. Number('') would wrongly return 0.
  return value !== null && Number.parseInt(value, 10) >= 0;
}

function isHidden(element: Element): boolean {
  if (
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true'
  ) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (view === null) {
    return true;
  }

  const style = view.getComputedStyle(element);
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    style.getPropertyValue('content-visibility') === 'hidden'
  );
}
