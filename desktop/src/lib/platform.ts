// Shortcuts are written once with "Mod" and shown as ⌘ on the Mac and Ctrl on Windows.

export const isMac = navigator.userAgent.includes("Mac");

/** "Mod ," → "⌘ ," on the Mac, "Ctrl ," elsewhere. */
export function keyLabel(keys: string): string {
  if (!isMac) return keys.replace(/\bMod\b/g, "Ctrl");
  return keys
    .replace(/\bMod\b/g, "⌘")
    .replace(/\bShift\b/g, "⇧")
    .replace(/\bAlt\b/g, "⌥")
    .replace(/\bEnter\b/g, "↵");
}

/** True when the event's Mod key (⌘ on the Mac, Ctrl elsewhere) is held. */
export function modKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
