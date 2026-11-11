// The learner's marks, typed in the box like Markdown (the same rules as compare.rs `parse_markup`):
// <didn't know>  [didn't catch]  {unexpected}  ~spelling~  *worth keeping*, and the full-width forms
// a Chinese keyboard types (《》【】｛｝～＊).

import type { Flag, Flagged } from "./backend";

const MARKUP: [Flag, string, string][] = [
  ["unknown", "<《〈＜", ">》〉＞"],
  ["missed", "[【［", "]】］"],
  ["unexpected", "{｛", "}｝"],
  ["spelling", "~～", ""],
  ["keep", "*＊", ""],
];

function markupChar(c: string): [Flag, boolean] | null {
  for (const [f, open, close] of MARKUP) {
    if (open.includes(c)) return [f, true];
    if (close.includes(c)) return [f, false];
  }
  return null;
}

/** The plain text and the marks on its words. `~` and `*` open and close by turns; an unclosed mark runs to the end. */
export function parseMarkup(typed: string): { words: string[]; flags: Flagged[] } {
  const words: string[] = [];
  const flags: Flagged[] = [];
  const open: [Flag, number][] = [];
  for (const raw of typed.split(/\s+/).filter(Boolean)) {
    const idx = words.length;
    let word = "";
    const closing: Flag[] = [];
    let prev = "";
    for (const c of raw) {
      const m = markupChar(c);
      if (!m) {
        word += c;
        prev = c;
        continue;
      }
      const [flag, opens] = m;
      const toggle = flag === "spelling" || flag === "keep";
      if (toggle && prev === c) continue;
      prev = c;
      const isOpen = open.some(([f]) => f === flag);
      if ((toggle && !isOpen) || (!toggle && opens)) open.push([flag, idx]);
      else if (isOpen) closing.push(flag);
    }
    if (word) words.push(word);
    for (const flag of closing) {
      let k = -1;
      open.forEach(([f], i) => f === flag && (k = i));
      if (k < 0) continue;
      const [[, from]] = open.splice(k, 1);
      const to = word ? idx : idx - 1;
      if (from <= to && from < words.length) flags.push({ from, to, flag });
    }
  }
  for (const [flag, from] of open) if (from < words.length) flags.push({ from, to: words.length - 1, flag });
  flags.sort((a, b) => a.from - b.from);
  return { words, flags };
}

export const hasMarkup = (typed: string) => [...typed].some((c) => markupChar(c) !== null);
