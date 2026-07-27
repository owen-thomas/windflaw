/**
 * The smallest possible element helper.
 *
 * Views build their DOM once and mutate it on update rather than re-rendering
 * — the phase 3 motion pass needs stable nodes to transition, and replacing
 * innerHTML would throw away every element mid-animation.
 */

import type { AppState } from '../lib/state';
import { prefersReducedMotion } from '../lib/motion';

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

/**
 * Set text with a quiet crossfade when it changes: this is a claim being
 * swapped for another claim, not a value counting toward it (see phase 3
 * motion inventory in DECISIONS.md — no figure is ever tweened, because a
 * crossfade says "this was replaced" and a tween would say "this changed
 * continuously", which is never true of a 30-minute-settled reading).
 *
 * Opt in per call site, not a replacement for setText: text nodes the 15s
 * render clock changes on its own (the masthead's "read N minutes ago")
 * must never carry this — it would crossfade every tick and read as
 * flicker rather than as a moment worth noticing.
 */
export function setTextCrossfade(node: HTMLElement, text: string): void {
  if (node.textContent === text) return;
  // Populating an empty node is not a claim being replaced — there was
  // nothing on screen to contradict — so the very first placeholder ("Reading")
  // still appears the instant it is asked for, exactly as before this pass.
  // The interesting crossfade is the one after: placeholder to real reading,
  // or one reading to the next.
  if (prefersReducedMotion() || node.textContent === '') {
    node.textContent = text;
    return;
  }
  node.classList.add('is-swapping');
  const swap = () => {
    node.textContent = text;
    node.classList.remove('is-swapping');
  };
  node.addEventListener('transitionend', swap, { once: true });
  // A node with no active transition (display:none ancestor, first paint
  // before the stylesheet has applied) never fires transitionend, and the
  // text must not hang mid-fade forever.
  setTimeout(swap, 260);
}

/** Set or remove an attribute in one call. */
export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name);
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function clear(node: Element): void {
  node.replaceChildren();
}
