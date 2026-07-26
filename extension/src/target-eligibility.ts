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

const excludedTextSelector = 'script,style,template,canvas,svg,code,pre';
const excludedContextControlSelector =
  'input,select,textarea,option,audio[controls],video[controls]';

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

  if (textParent === null || isInsideEditableContent(textParent)) {
    return false;
  }

  return !ancestryBelowBody(textParent).some(
    (element) =>
      isHidden(element) ||
      element.matches(excludedTextSelector) ||
      element.matches(excludedContextControlSelector),
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
    element.matches(excludedTextSelector) ||
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
  return value !== null && Number(value) >= 0;
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
