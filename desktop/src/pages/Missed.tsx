// Hearing the missed sentences again (moved here from the phone): each sentence with mistakes plays twice from this
// computer's own file, so the timing is always right, then shows with what was typed. Which sentences come here is
// what the Review page sends to the phone: real mistakes and flags, not spelling slips, unless the learner chose.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { MarkedText } from "../components/Marks";
import { Kbd, Page } from "../components/Shell";
import { backend, on, type MissedSentence } from "../lib/backend";
import { clock, plural } from "../lib/format";
import { usePlayer } from "../lib/playback";

/** Plays before the text shows. */
const PLAYS = 2;
/** Quiet between plays, in ms. */
const GAP_MS = 1200;
const SLOW = 0.75;

const KEYS: [string, string][] = [
  ["Space", "Play again"],
  ["S", "Show text"],
  ["Enter", "Next"],
  ["←", "Back"],
  ["⇧ R", "Slower"],
];

/** The missed sentences, newest dictation first; `?item=` keeps one episode's. */
export function useMissed(itemId?: number): MissedSentence[] | null {
  const [all, setAll] = useState<MissedSentence[] | null>(null);
  useEffect(() => {
    const load = () => backend.missedSentences().then(setAll, () => setAll([]));
    load();
    return on("practice", load);
  }, []);
  return useMemo(() => (all && itemId ? all.filter((m) => m.itemId === itemId) : all), [all, itemId]);
}

export function MissedScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const itemId = Number(params.get("item")) || undefined;
  const loaded = useMissed(itemId);
  // Kept as it was when opened: answering elsewhere mustn't reshuffle the list being heard.
  const [items, setItems] = useState<MissedSentence[] | null>(null);
  useEffect(() => {
    if (loaded && items === null) setItems(loaded);
  }, [loaded, items]);

  const [pos, setPos] = useState(0);
  const [plays, setPlays] = useState(0);
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const [done, setDone] = useState(false);
  const m = items?.[pos] ?? null;
  const player = usePlayer(m?.path ?? null);
  const wait = useRef<number | null>(null);
  // Set while this page stops the audio itself, so that stop doesn't count as a play.
  const stopping = useRef(false);
  const wasPlaying = useRef(false);

  const clearWait = () => {
    if (wait.current !== null) window.clearTimeout(wait.current);
    wait.current = null;
  };
  const playNow = useCallback(() => {
    if (!m) return;
    clearWait();
    player.play(m.startMs, m.endMs, slow ? SLOW : 1);
  }, [m, player, slow]);

  // A new sentence: start over with it.
  useEffect(() => {
    setPlays(0);
    setShown(false);
    if (!m || done) return;
    const t = window.setTimeout(() => player.play(m.startMs, m.endMs, slow ? SLOW : 1), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, items, done]);

  // A play ended: count it, play again after a pause, or show the text.
  useEffect(() => {
    const ended = wasPlaying.current && !player.playing;
    wasPlaying.current = player.playing;
    if (!ended) return;
    if (stopping.current) {
      stopping.current = false;
      return;
    }
    const n = plays + 1;
    setPlays(n);
    if (n >= PLAYS) setShown(true);
    else wait.current = window.setTimeout(playNow, GAP_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.playing]);

  useEffect(() => clearWait, []);

  const go = useCallback(
    (to: number) => {
      if (!items) return;
      clearWait();
      if (player.playing) {
        stopping.current = true;
        player.stop();
      }
      if (to >= items.length) setDone(true);
      else setPos(Math.max(0, to));
    },
    [items, player],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || done) return;
      if (e.key === " ") playNow();
      else if (e.key.toLowerCase() === "s" && !e.shiftKey) setShown((v) => !v);
      else if (e.key === "Enter" || e.key === "ArrowRight") go(pos + 1);
      else if (e.key === "ArrowLeft") go(pos - 1);
      else if (e.key === "R" && e.shiftKey) setSlow((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playNow, go, pos, done]);

  const crumbs = ["Today", "Missed sentences"].map((label, i) => (i === 0 ? { label, to: "/today" } : label));

  if (items === null) {
    return (
      <Page crumbs={crumbs}>
        <div className="page">Opening…</div>
      </Page>
    );
  }

  if (items.length === 0) {
    return (
      <Page crumbs={crumbs}>
        <div className="page" style={{ maxWidth: 640, gap: 12 }}>
          <h1 className="h1">Nothing to hear again</h1>
          <p className="muted">Sentences you get wrong while dictating come here, so you can hear them again with what you typed.</p>
          <div>
            <button type="button" className="btn" onClick={() => navigate("/today")}>
              Back to Today
            </button>
          </div>
        </div>
      </Page>
    );
  }

  if (done) {
    return (
      <Page crumbs={crumbs}>
        <div className="page" style={{ maxWidth: 640, gap: 16 }}>
          <span className="missed-done-icon" aria-hidden>
            <Icon name="check" size={22} />
          </span>
          <h1 className="h1">All {plural(items.length, "sentence")} heard</h1>
          <p className="muted">They stay here until you dictate the episode again.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDone(false);
                setPos(0);
              }}
            >
              Hear them again
            </button>
            <button type="button" className="btn" onClick={() => navigate("/today")}>
              Back to Today
            </button>
          </div>
        </div>
      </Page>
    );
  }

  const cur = m!;
  const a = cur.answer;
  return (
    <Page crumbs={crumbs} keys={KEYS}>
      <div className="page" style={{ maxWidth: 760, gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-subtle)" }}>
            {pos + 1} of {items.length}
          </span>
          <div className="track" style={{ flexGrow: 1 }}>
            <div className="fill" style={{ width: `${Math.round(((pos + 1) / items.length) * 100)}%` }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Art url={cur.artworkUrl} size={44} radius={8} file={cur.source === "My files"} />
          <div style={{ minWidth: 0 }}>
            <div className="ell" style={{ font: "500 14px/1.3 var(--font-text)", color: "var(--ink)" }}>
              {cur.title}
            </div>
            <div className="ell" style={{ fontSize: 12, color: "var(--ink-subtle)", marginTop: 2 }}>
              {cur.source} · sentence {a.idx + 1} · {clock(cur.startMs / 1000)}
            </div>
          </div>
        </div>

        <section className="panel" aria-live="polite" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16, minHeight: 170 }}>
          <div className="eyebrow">The sentence</div>
          {shown ? (
            <div style={{ fontSize: 18, lineHeight: 1.6 }}>{a.comparison ? <MarkedText words={a.comparison.original} /> : a.original}</div>
          ) : (
            <div className="muted" style={{ fontSize: 14 }}>
              {player.error
                ? `Couldn't play it: ${player.error}`
                : plays === 0
                  ? "Listen. The text shows after the second play."
                  : "Once more…"}
            </div>
          )}
          {shown && (
            <>
              <div className="eyebrow">You typed</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-muted)" }}>
                {a.comparison?.typed.length ? <MarkedText words={a.comparison.typed} /> : <span className="muted">(nothing typed)</span>}
              </div>
            </>
          )}
        </section>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => go(pos - 1)} disabled={pos === 0} aria-label="Previous sentence">
            <Icon name="back" size={13} />
          </button>
          <button type="button" className="btn" onClick={playNow}>
            <Icon name={player.playing ? "speaker" : "replay"} size={13} />
            {player.playing ? "Playing…" : "Play again"}
            <Kbd keys="Space" />
          </button>
          <button type="button" className={slow ? "btn" : "btn btn-ghost"} aria-pressed={slow} onClick={() => setSlow((v) => !v)}>
            {SLOW}×
          </button>
          {!shown && (
            <button type="button" className="btn btn-ghost" onClick={() => setShown(true)}>
              <Icon name="eye" size={13} />
              Show text
              <Kbd keys="S" />
            </button>
          )}
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="btn btn-primary" onClick={() => go(pos + 1)}>
            {pos + 1 === items.length ? "Finish" : "Next"}
            <Kbd keys="Enter" />
          </button>
        </div>
      </div>
    </Page>
  );
}
