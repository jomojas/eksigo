// A sentence with each word marked as the comparison found it: missed words boxed, wrong ones red,
// misspelled ones underlined.

import type { Marked } from "../lib/backend";

const TITLES: Partial<Record<Marked["mark"], string>> = {
  missing: "Missed",
  wrong: "Wrong word",
  spelling: "Spelling: heard, but misspelled (half a word)",
  extra: "Not in the original",
  gap: "A part you didn't catch",
};

/** `indexed`: each word carries `data-i`, its place in the sentence, for looking up a selection. */
export function MarkedText({ words, indexed }: { words: Marked[]; indexed?: boolean }) {
  return (
    <span className="marked">
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={`w w-${w.mark}`} title={TITLES[w.mark]} data-i={indexed ? i : undefined}>
            {w.text}
          </span>
        </span>
      ))}
    </span>
  );
}

/** A sentence as plain words carrying `data-i`, for looking up a selection. */
export function IndexedText({ text }: { text: string }) {
  return (
    <span className="marked">
      {text
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => (
          <span key={i}>
            {i > 0 && " "}
            <span data-i={i}>{w}</span>
          </span>
        ))}
    </span>
  );
}

/** The words a selection inside `root` covers, by their `data-i`. */
export function selectedWords(root: HTMLElement | null): [number, number] | null {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const idx = [...root.querySelectorAll<HTMLElement>("[data-i]")]
    .filter((el) => range.intersectsNode(el) && (el.textContent ?? "").trim())
    .map((el) => Number(el.dataset.i));
  if (idx.length === 0) return null;
  return [Math.min(...idx), Math.max(...idx)];
}
