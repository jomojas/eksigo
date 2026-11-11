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

export function MarkedText({ words }: { words: Marked[] }) {
  return (
    <span className="marked">
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={`w w-${w.mark}`} title={TITLES[w.mark]}>
            {w.text}
          </span>
        </span>
      ))}
    </span>
  );
}
