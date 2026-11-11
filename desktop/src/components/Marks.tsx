// A sentence with each word marked: by the comparison (missed words boxed, wrong ones red, misspelled ones
// underlined) and by the learner, who types marks in the box (lib/markup.ts). A learner's mark wins
// over the comparison's on the same word.

import type { Flag, Flagged, Marked } from "../lib/backend";

const TITLES: Partial<Record<Marked["mark"], string>> = {
  missing: "Missed",
  wrong: "Wrong word",
  spelling: "Spelling: heard, but misspelled (half a word)",
  extra: "Not in the original",
  gap: "A part you didn't catch",
};

/** The learner's marks and how to type them. */
export const FLAGS: { flag: Flag; label: string; syntax: string; title: string }[] = [
  { flag: "unknown", label: "didn't know", syntax: "<…>", title: "A word or phrase you didn't know · counts as wrong" },
  { flag: "missed", label: "didn't catch", syntax: "[…]", title: "You know it, but didn't catch it in the audio · counts as wrong" },
  { flag: "unexpected", label: "unexpected", syntax: "{…}", title: "You expected something else · counts as wrong" },
  { flag: "spelling", label: "spelling", syntax: "~…~", title: "Spelled differently from what you thought · half a word" },
  { flag: "keep", label: "worth keeping", syntax: "*…*", title: "A good expression to remember · doesn't change the score" },
];

export const flagAt = (flags: Flagged[] | undefined, i: number) => flags?.find((f) => f.from <= i && i <= f.to)?.flag;

/** A marked word's classes: a phrase gets its brackets once, around the whole of it. */
function flagClass(flags: Flagged[] | undefined, i: number): string | undefined {
  const f = flags?.find((x) => x.from <= i && i <= x.to);
  if (!f) return undefined;
  return `f f-${f.flag}${i === f.from ? " f-from" : ""}${i === f.to ? " f-to" : ""}`;
}

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

/** Plain words with the learner's marks, e.g. the box as it will be read. */
export function FlaggedWords({ words, flags }: { words: string[]; flags: Flagged[] }) {
  return (
    <span className="marked">
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={flagClass(flags, i)}>{w}</span>
        </span>
      ))}
    </span>
  );
}
