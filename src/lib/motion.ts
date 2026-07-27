/**
 * The one thing tokens.css cannot do on its own.
 *
 * Collapsing --dur-* to ~0 handles every CSS transition for reduced motion,
 * but the flow marks (constraint.ts) are a requestAnimationFrame loop, not a
 * transition, so nothing in CSS can stop them. This is checked once and read
 * everywhere a JS-driven loop needs to decide whether to run at all.
 */

const query = matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion(): boolean {
  return query.matches;
}
