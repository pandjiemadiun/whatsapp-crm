/**
 * Lightweight class concatenation utility (no external deps).
 * Replaces clsx + tailwind-merge pattern used by OpenShip's shadcn setup.
 * Filters out falsy values and joins with space.
 */
export function cn(...classes: (string | undefined | null | false | number)[]) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Touch target minimum (44px) — enforces accessible tap targets.
 * Use as `min-h-[2.75rem]` or the `touch-target` utility class.
 */
export const TOUCH_TARGET_SIZE = 44;

/**
 * Check if a value is oklch-compatible (for runtime color validation).
 * Returns true if the string matches oklch() or oklch with alpha.
 */
export function isOklch(value: string): boolean {
  return /^oklch\(/i.test(value);
}
