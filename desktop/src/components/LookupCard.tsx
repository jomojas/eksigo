// The dictionary card for words selected in a review (DESIGN.md, "Results"): the phrase if the dictionary
// has it, else each word; the words as said in the episode or read slowly; and Add to My words.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { backend, type Entry, type Lookup } from "../lib/backend";
import { usePlayer } from "../lib/playback";
import { firstLine, speak, useMeaningLanguage } from "../lib/words";
import { Icon } from "./Icon";
import { Kbd } from "./Shell";

export type Selection = {
  itemId: number;
  idx: number;
  /** The selected written words of the sentence, from..=to. */
  from: number;
  to: number;
  text: string;
  typed: string;
  rect: DOMRect;
};

const WIDTH = 360;

export function LookupCard({ sel, path, onClose }: { sel: Selection; path: string | null; onClose: () => void }) {
  const [lang] = useMeaningLanguage();
  const [result, setResult] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [times, setTimes] = useState<[number, number][]>([]);
  const player = usePlayer(path);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: sel.rect.bottom + 8, left: sel.rect.left });

  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    backend.lookup(lang, sel.text).then(
      (r) => live && setResult(r),
      (e) => live && setError(String(e)),
    );
    backend.wordSaved(sel.text).then((id) => live && setSavedId(id));
    backend.wordTimes(sel.itemId, sel.idx).then((t) => live && setTimes(t), () => {});
    return () => {
      live = false;
    };
  }, [lang, sel.text, sel.itemId, sel.idx]);

  // Below the selection, or above it when there's no room; always inside the window.
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? 300;
    const below = sel.rect.bottom + 8;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, sel.rect.top - h - 8) : below;
    const left = Math.min(Math.max(12, sel.rect.left), window.innerWidth - WIDTH - 12);
    setPos({ top, left });
  }, [sel.rect, result, error]);

  const save = async () => {
    if (!result || savedId) return;
    const entry = result.entry;
    const words = result.words.map((w) => `${w.text}${w.entry && w.entry.headword !== w.text ? ` (${w.entry.headword})` : ""}: ${w.entry ? firstLine(w.entry.meaning) : "—"}`);
    const meaning =
      entry && result.whole ? entry.meaning : [entry ? `${entry.headword}: ${firstLine(entry.meaning)}` : null, ...words].filter(Boolean).join("\n");
    try {
      const w = await backend.addWord({
        text: result.query || sel.text,
        headword: entry && result.whole ? entry.headword : "",
        ipa: entry && result.whole ? entry.ipa : "",
        meaning,
        note,
        itemId: sel.itemId,
        idx: sel.idx,
        from: sel.from,
        to: sel.to,
        typed: sel.typed,
      });
      setSavedId(w.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const asSaid = () => {
    const a = times[sel.from];
    const b = times[Math.min(sel.to, times.length - 1)];
    if (a && b) player.play(a[0], b[1], 1);
  };

  // A adds, Esc closes; typing in the note is left alone.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea");
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      save();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onDown = (e: MouseEvent) => {
      if (card.current && !card.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const entry = result?.entry ?? null;
  const single = result ? result.words.length === 0 : !sel.text.trim().includes(" ");
  const title = result?.whole && entry ? entry.headword : result?.query || sel.text;

  return (
    <div ref={card} className="lookup" role="dialog" aria-label={title} style={{ top: pos.top, left: pos.left, width: WIDTH }}>
      <div>
        <div className="h2" style={{ fontSize: 18 }}>
          {title}
        </div>
        {result?.whole && entry && entry.headword !== result.query && <div className="lookup-sub">from “{result.query}”</div>}
        {result?.whole && entry?.ipa && <div className="lookup-sub mono">{entry.ipa}</div>}
        {result && !result.whole && !single && <div className="lookup-sub">Not in the dictionary as a phrase · each word</div>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-sm" onClick={asSaid} disabled={!path || times.length === 0}>
          <Icon name="play" size={11} />
          As said in the episode
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => speak(sel.text)} title="Read by your computer's voice">
          <Icon name="speaker" size={14} />
          Slow voice
        </button>
      </div>

      {error && (
        <div className="notice notice-error" role="alert" style={{ fontSize: 13 }}>
          {error}
        </div>
      )}
      {!result && !error && <div className="lookup-sub">Looking it up… (the dictionary downloads once, about 5 MB)</div>}

      {result && result.whole && entry && <Meaning entry={entry} />}
      {result && !result.whole && entry && (
        <div className="lookup-found">
          <div className="lookup-sub">Phrase inside</div>
          <b>{entry.headword}</b>
          <span>{firstLine(entry.meaning)}</span>
        </div>
      )}
      {result && single && !entry && <div className="lookup-sub">Not in the dictionary. Add it with your own note.</div>}
      {result && result.words.length > 0 && (
        <div>
          {result.words.map((w, i) => (
            <div key={i} className="wordline">
              <b>{w.text}</b>
              <span>
                {w.entry ? (
                  <>
                    <span className="mono lookup-ipa">
                      {w.entry.headword !== w.text && `→ ${w.entry.headword} `}
                      {w.entry.ipa}
                    </span>{" "}
                    {firstLine(w.entry.meaning)}
                  </>
                ) : (
                  <span style={{ color: "var(--ink-tertiary)" }}>not found</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {result && (!result.whole || !entry) && !savedId && (
        <label className="lookup-note">
          Your note
          <span className="input">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your own meaning, in any language" />
          </span>
        </label>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)", flexWrap: "wrap" }}>
        {savedId ? (
          <span className="flag-label" style={{ color: "var(--semantic-success)" }}>
            <Icon name="check" size={14} />
            In My words
          </span>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!result}>
            <Icon name="plus" size={13} />
            Add to My words <Kbd keys="A" />
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" disabled title="Needs an AI key (Settings, later)">
          Explain in this sentence
        </button>
        <span className="badge badge-next" style={{ height: 20, fontSize: 11 }}>
          AI key
        </span>
      </div>
      {result?.source && <div className="lookup-credit">Meanings: {result.source}</div>}
    </div>
  );
}

function Meaning({ entry }: { entry: Entry }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-line" }}>{entry.meaning}</div>
      {entry.definition && <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-subtle)", whiteSpace: "pre-line" }}>{entry.definition}</div>}
    </div>
  );
}
