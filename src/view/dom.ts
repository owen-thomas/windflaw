/**
 * The smallest possible element helper.
 *
 * Views build their DOM once and mutate it on update rather than re-rendering
 * — the phase 3 motion pass needs stable nodes to transition, and replacing
 * innerHTML would throw away every element mid-animation.
 */

import type { AppState } from '../lib/state';

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/** Every zone of the screen: built once, updated in place. */
export interface View {
  el: HTMLElement;
  update(state: AppState): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Set text only when it has changed, so unchanged nodes are left untouched. */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Set or remove an attribute in one call. */
export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name);
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function clear(node: Element): void {
  node.replaceChildren();
}
