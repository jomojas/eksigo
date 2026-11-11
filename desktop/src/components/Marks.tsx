// A sentence with each word marked: by the comparison (missed words boxed, wrong ones red, misspelled ones
// underlined) and by the learner (what they didn't know or catch, didn't expect, would have spelled
// differently, or want to keep). A learner's mark wins over the comparison's on the same word.

import type { Flag, Flagged, Marked } from "../lib/backend";

const TITLES: Partial<Record<Marked["mark"], string>> = {
  missing: "Missed",
  wrong: "Wrong word",
  spelling: "Spelling: heard, but misspelled (half a word)",
  extra: "Not in the original",
  gap: "A part you didn't catch",
};

/** The learner's marks, in key order: `1` to `5`. */
export const FLAGS: { flag: Flag; label: string; title: string }[] = [
  { flag: "unknown", label: "Didn't know", title: "A word or phrase you didn't know · counts as wrong" },
  { flag: "missed", label: "Didn't catch", title: "You know it, but didn't catch it in the audio · counts as wrong" },
  { flag: "unexpected", label: "Unexpected", title: "You expected something else · counts as wrong" },
  { flag: "spelling", label: "Spelling", title: "Spelled differently from what you thought · half a word" },
  { flag: "keep", label: "Worth keeping", title: "A good expression to remember · doesn't change the score" },
];

export const flagAt = (flags: Flagged[] | undefined, i: number) => flags?.find((f) => f.from <= i && i <= f.to)?.flag;

/** A marked word's classes: a phrase gets its brackets once, around the whole of it. */
function flagClass(flags: Flagged[] | undefined, i: number): string | undefined {
  const f = flags?.find((x) => x.from <= i && i <= x.to);
  if (!f) return undefined;
  return `f f-${f.flag}${i === f.from ? " f-from" : ""}${i === f.to ? " f-to" : ""}`;
}

/** The same split as the core's: written words, by whitespace. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

export function MarkedText({ words, flags }: { words: Marked[]; flags?: Flagged[] }) {
  return (
    <span className="marked">
      {words.map((w, i) => {
        const f = flagAt(flags, i);
        const meta = f && FLAGS.find((x) => x.flag === f);
        return (
          <span key={i}>
            {i > 0 && " "}
            <span className={flagClass(flags, i) ?? `w w-${w.mark}`} title={meta ? meta.label : TITLES[w.mark]}>
              {w.text}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The original with the learner's marks, words addressable by `data-i` for marking a selection. */
export function FlaggedText({ text, flags }: { text: string; flags: Flagged[] }) {
  return (
    <span className="marked">
      {wordsOf(text).map((w, i) => {
        const f = flagAt(flags, i);
        return (
          <span key={i}>
            {i > 0 && " "}
            <span data-i={i} className={flagClass(flags, i)} title={f && FLAGS.find((x) => x.flag === f)?.label}>
              {w}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Marks `from..=to` with `flag` (or clears it with null), replacing marks it overlaps; the same mark twice removes it. */
export function setFlag(flags: Flagged[], from: number, to: number, flag: Flag | null): Flagged[] {
  const same = flag && flags.some((f) => f.from === from && f.to === to && f.flag === flag);
  const rest = flags.filter((f) => f.to < from || f.from > to);
  return same || !flag ? rest : [...rest, { from, to, flag }].sort((a, b) => a.from - b.from);
}

/** The words a selection inside `root` covers, by their `data-i`. */
export function selectedWords(root: HTMLElement | null): [number, number] | null {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const idx = [...root.querySelectorAll<HTMLElement>("[data-i]")].filter((el) => range.intersectsNode(el) && (el.textContent ?? "").trim()).map((el) => Number(el.dataset.i));
  if (idx.length === 0) return null;
  return [Math.min(...idx), Math.max(...idx)];
}
