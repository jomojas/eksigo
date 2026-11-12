// My words (design D09): every word or phrase saved from a review, with its meaning, the learner's note,
// each sentence it was heard in, its level and when it's next practised.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import { Page } from "../components/Shell";
import { backend, type Level, type SavedWord, type WordContext } from "../lib/backend";
import { clock, nextPractice, plural } from "../lib/format";
import { usePlayer } from "../lib/playback";
import { firstLine, LEVELS, levelName, speak, usePracticeCounts, useWords } from "../lib/words";
import { Kbd } from "../components/Shell";

export function Words() {
  const [words, loaded] = useWords();
  const counts = usePracticeCounts();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words
      .filter((w) => !level || w.level === level)
      .filter((w) => !q || w.text.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q) || w.note.toLowerCase().includes(q));
  }, [words, query, level]);
  const toPractise = counts?.total ?? 0;
  const selected = shown.find((w) => w.id === selectedId) ?? shown[0] ?? null;

  // ↑ ↓ move through the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey && toPractise > 0) {
        e.preventDefault();
        navigate("/words/practice");
        return;
      }
      if (!selected) return;
      const i = shown.indexOf(selected);
      if (e.key === "ArrowDown" && i < shown.length - 1) setSelectedId(shown[i + 1].id);
      else if (e.key === "ArrowUp" && i > 0) setSelectedId(shown[i - 1].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, toPractise, navigate]);

  return (
    <Page crumbs={["My words"]} keys={[["P", "Practise"], ["↑ ↓", "Move"]]}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <div className="page" style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="h1" style={{ flexGrow: 1 }}>
              My words
              {words.length > 0 && (
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-subtle)", marginLeft: 10, fontWeight: 400 }}>
                  {words.length}
                </span>
              )}
            </h1>
            <button type="button" className="btn btn-primary" disabled={toPractise === 0} onClick={() => navigate("/words/practice")}>
              {toPractise > 0 ? `Practise ${toPractise}` : "Nothing to practise now"}
              {toPractise > 0 && <Kbd keys="P" />}
            </button>
          </div>
          {words.length > 0 && (
            <div className="pills" role="group" aria-label="Level" style={{ alignSelf: "flex-start" }}>
              <button type="button" className="pill" aria-pressed={level === null} onClick={() => setLevel(null)}>
                All <span className="mono">{words.length}</span>
              </button>
              {LEVELS.map(([l, name]) => (
                <button key={l} type="button" className="pill" aria-pressed={level === l} onClick={() => setLevel(level === l ? null : l)}>
                  {name} <span className="mono">{words.filter((w) => w.level === l).length}</span>
                </button>
              ))}
            </div>
          )}
          {loaded && words.length === 0 ? (
            <div className="empty">
              <h2 className="h2">No words saved yet</h2>
              <p>After a dictation, select words in the review's original to look them up, then press A to add them here, with the sentence you heard them in.</p>
            </div>
          ) : (
            <>
              <label className="input" style={{ maxWidth: 420 }}>
                <Icon name="search" size={14} />
                <input type="search" placeholder="Search your words" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your words" />
              </label>
              <div className="panel" style={{ overflow: "hidden" }} role="list">
                <div className="th" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) 84px 96px" }}>
                  <span>Word or phrase</span>
                  <span>Meaning</span>
                  <span>Level</span>
                  <span>Next</span>
                </div>
                {shown.map((w) => (
                  <div
                    key={w.id}
                    role="listitem"
                    tabIndex={0}
                    className={`tr${selected?.id === w.id ? " tr-on" : ""}`}
                    style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) 84px 96px", cursor: "pointer" }}
                    onClick={() => setSelectedId(w.id)}
                    onFocus={() => setSelectedId(w.id)}
                  >
                    <b className="ell">{w.text}</b>
                    <span className="ell">{w.note || firstLine(w.meaning) || "—"}</span>
                    <span>{levelName(w.level)}</span>
                    <span>{nextPractice(w.dueAt)}</span>
                  </div>
                ))}
                {shown.length === 0 && loaded && <div style={{ padding: 16 }}>{query ? `No words match “${query}”.` : "No words at this level."}</div>}
              </div>
            </>
          )}
        </div>
        {selected && <Detail key={selected.id} word={selected} />}
      </div>
    </Page>
  );
}

function Detail({ word: w }: { word: SavedWord }) {
  const [note, setNote] = useState(w.note);
  const [confirming, setConfirming] = useState(false);
  const saveNote = () => {
    if (note.trim() !== w.note) backend.setWordNote(w.id, note);
  };
  return (
    <aside className="insp" aria-label={w.text} style={{ width: 360 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 className="h2" style={{ fontSize: 20, flexGrow: 1 }}>
            {w.text}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Read it slowly" title="Read by your computer's voice" onClick={() => speak(w.text)}>
            <Icon name="speaker" size={15} />
          </button>
        </div>
        {(w.ipa || (w.headword && w.headword !== w.text.toLowerCase())) && (
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-subtle)" }}>
            {w.headword && w.headword !== w.text.toLowerCase() ? `${w.headword} ` : ""}
            {w.ipa}
          </div>
        )}
        {w.meaning && <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-line" }}>{w.meaning}</div>}
      </div>
      <div>
        <div className="prop">
          Level<b>{levelName(w.level)}</b>
        </div>
        <div className="prop">
          Next practice<b>{w.level === "new" ? "When you practise next" : nextPractice(w.dueAt)}</b>
        </div>
        <div className="prop">
          Practised<b>{w.reviews === 0 ? "Not yet" : plural(w.reviews, "time")}</b>
        </div>
      </div>
      <label className="lookup-note">
        Your note
        <textarea
          className="note-box"
          rows={2}
          value={note}
          placeholder="Your own meaning, in any language"
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
        />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="eyebrow">Heard in {w.contexts.length === 1 ? "1 sentence" : `${w.contexts.length} sentences`}</div>
        {w.contexts.map((c, i) => (
          <Context key={i} c={c} text={w.text} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => backend.removeWord(w.id)}>
              Remove “{w.text}”
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <>
            {w.level !== "known" && (
              <button type="button" className="btn btn-sm" title="Known now; it comes back in a year to check" onClick={() => backend.practiceKnow(w.id)}>
                I know this
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
              Remove from My words
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/** One sentence the word was heard in: played whole, with the episode and where it is in it. */
function Context({ c, text }: { c: WordContext; text: string }) {
  const player = usePlayer(c.path);
  const navigate = useNavigate();
  const i = c.sentence.toLowerCase().indexOf(text.toLowerCase());
  return (
    <div className="panel" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <button
          type="button"
          className="btn flag-btn"
          style={{ borderRadius: 9999, color: "var(--ink-muted)", flexShrink: 0 }}
          aria-label="Play the sentence"
          title={c.path ? "Play the sentence" : "The episode is no longer in your library"}
          disabled={!c.path}
          onClick={() => (player.playing ? player.stop() : player.play(c.sentenceStartMs, c.sentenceEndMs, 1))}
        >
          <Icon name={player.playing ? "pause" : "play"} size={11} />
        </button>
        <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink)" }}>
          {i >= 0 ? (
            <>
              {c.sentence.slice(0, i)}
              <span className="sel-mark">{c.sentence.slice(i, i + text.length)}</span>
              {c.sentence.slice(i + text.length)}
            </>
          ) : (
            c.sentence
          )}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-subtle)", paddingLeft: 36, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {c.itemTitle && c.itemId ? (
          <button
            type="button"
            className="link-btn"
            title="Open the episode at this sentence"
            onClick={() => navigate(`/library/${c.itemId}`, { state: { at: c.sentenceStartMs } })}
          >
            {c.itemTitle}
          </button>
        ) : (
          <span>From an episode no longer in your library</span>
        )}
        <span className="mono">
          {clock(c.sentenceStartMs / 1000)}–{clock(c.sentenceEndMs / 1000)}
        </span>
      </div>
    </div>
  );
}
