// Required template nodes fail at startup with a useful selector, rather than
// much later during animation. Optional/dynamic nodes use querySelector directly.
export function requiredElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return node;
}

// Reassigning textContent replaces text nodes even when the text is unchanged.
export function updateText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}
