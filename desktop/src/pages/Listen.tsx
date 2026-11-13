// Listen (design D07, DESIGN.md "Listen"): the episode straight through, with its sentences hidden until the
// learner shows them, to test their ears before their eyes. A shown sentence stays shown; select words in it to
// look them up and save them. Time listening counts towards the streak, like dictation.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Icon } from "../components/Icon";
import { LookupCard, type Selection } from "../components/LookupCard";
import { IndexedText, selectedWords } from "../components/Marks";
import { Kbd, Page } from "../components/Shell";
import { backend, type Item, type Sentence, type Show, type TranscriptStatus } from "../lib/backend";
import { dictationPath } from "../lib/dictation";
import { useLibraryChanged } from "../lib/downloads";
import { clock, plural } from "../lib/format";
import { sentenceAt, SPEEDS, usePlayer } from "../lib/playback";
import { isBusy, transcribed, useTranscript } from "../lib/transcripts";

export const listenPath = (itemId: number) => `/library/${itemId}/listen`;

const KEYS: [string, string][] = [
  ["Space", "Play"],
  ["↑ ↓", "Sentence"],
  ["S", "Show this one"],
  ["Shift S", "Show all"],
  ["R", "Replay"],
];

/** Within this long of a sentence's start, Replay and ↑ go to the sentence before. */
const RESTART_MS = 1200;
/** Listening time is saved this often while playing, and when playback stops. */
const SAVE_EVERY_S = 15;
/** After the learner scrolls away, the sentence being heard comes back to the middle this long after they stop. */
const BACK_AFTER_MS = 2500;

export function ListenScreen() {
  const itemId = Number(useParams().itemId);
  const navigate = useNavigate();
  // Opened from My words at a sentence (`state.at`, ms): playback starts there, with that sentence shown.
  const startAt = (useLocation().state as { at?: number } | null)?.at ?? null;
  const [item, setItem] = useState<Item | null>(null);
  const [show, setShow] = useState<Show | null>(null);

  const loadItem = useCallback(async () => {
    try {
      const it = await backend.item(itemId);
      setItem(it);
      if (it.episodeId) setShow((await backend.getEpisode(it.episodeId)).show);
    } catch {
      navigate("/library", { replace: true });
    }
  }, [itemId, navigate]);
  useEffect(() => {
    loadItem();
  }, [loadItem]);
  useLibraryChanged(loadItem);

  // The transcript, which may still be growing.
  const [initial, setInitial] = useState<TranscriptStatus | null>(null);
  useEffect(() => {
    backend.transcriptStatus(itemId).then(setInitial);
  }, [itemId]);
  const status = useTranscript(itemId, initial);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const count = status?.sentences ?? 0;
  useEffect(() => {
    if (count > 0) backend.sentences(itemId).then(setSentences);
  }, [itemId, count]);
  // No transcript yet: start it, as dictation does. The audio plays meanwhile.
  const asked = useRef(false);
  useEffect(() => {
    if (item?.state === "ready" && status?.state === "none" && !asked.current) {
      asked.current = true;
      backend.transcribe(itemId);
    }
  }, [item?.state, status?.state, itemId]);

  const player = usePlayer(item?.state === "ready" ? item.path : null);
  const [speed, setSpeed] = useState(1);
  const [at, setAt] = useState(startAt ?? 0);
  const durMs = (item?.durationS ?? 0) * 1000;
  const pos = player.playing ? player.positionMs : at;
  const current = sentenceAt(sentences, pos);
  useEffect(() => {
    if (player.playing) setAt(player.positionMs);
  }, [player.playing, player.positionMs]);

  // Hidden by default every time; a sentence once shown stays shown.
  const [shown, setShown] = useState<Set<number>>(() => new Set());
  const [allShown, setAllShown] = useState(false);
  const isShown = (i: number) => allShown || shown.has(i);
  const toggleShown = useCallback((i: number) => {
    if (i < 0) return;
    setShown((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const openedAt = useRef(false);
  useEffect(() => {
    if (startAt === null || openedAt.current || sentences.length === 0) return;
    const i = sentenceAt(sentences, startAt);
    if (i < 0) return;
    openedAt.current = true;
    setShown((s) => new Set(s).add(i));
  }, [startAt, sentences]);

  const playFrom = useCallback(
    (ms: number, s = speed) => {
      const start = Math.max(0, Math.min(ms, durMs ? durMs - 500 : ms));
      setAt(start);
      player.play(start, null, s);
    },
    [player, speed, durMs],
  );
  const [follow, setFollow] = useState(true);
  const toggle = useCallback(() => {
    if (player.playing) return player.stop();
    setFollow(true);
    playFrom(at >= durMs - 500 && durMs ? 0 : at);
  }, [player, playFrom, at, durMs]);
  const playSentence = useCallback(
    (i: number) => {
      if (i < 0 || i >= sentences.length) return;
      setFollow(true);
      playFrom(sentences[i].startMs);
    },
    [sentences, playFrom],
  );
  /** ↑: the sentence before (or this one's start, once it's a moment in); ↓: the next one. */
  const step = useCallback(
    (dir: -1 | 1) => {
      if (sentences.length === 0) return;
      if (current < 0) return playSentence(dir > 0 ? Math.max(0, sentenceAt(sentences, pos) + 1) : 0);
      if (dir > 0) return playSentence(Math.min(sentences.length - 1, current + 1));
      playSentence(pos - sentences[current].startMs < RESTART_MS ? Math.max(0, current - 1) : current);
    },
    [sentences, current, pos, playSentence],
  );
  const replay = useCallback(() => {
    if (current < 0) return playFrom(Math.max(0, pos - 5000));
    const prev = pos - sentences[current].startMs < RESTART_MS && current > 0;
    playSentence(prev ? current - 1 : current);
  }, [current, sentences, pos, playFrom, playSentence]);

  // The word being said in the sentence being heard, so its hidden words fill in as they're spoken.
  const [times, setTimes] = useState<[number, number][]>([]);
  const currentIdx = current >= 0 ? sentences[current]?.idx : null;
  useEffect(() => {
    setTimes([]);
    if (currentIdx == null) return;
    let live = true;
    backend.wordTimes(itemId, currentIdx).then((t) => live && setTimes(t), () => {});
    return () => {
      live = false;
    };
  }, [itemId, currentIdx]);
  const heard = times.filter(([start]) => start <= pos).length;

  // Looking a word up pauses playback; closing the card carries on if it was playing.
  const [lookup, setLookup] = useState<Selection | null>(null);
  const resume = useRef(false);
  const onSelect = (i: number, e: MouseEvent<HTMLElement>) => {
    const root = e.currentTarget;
    window.setTimeout(() => {
      const range = selectedWords(root);
      const r = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (!range || !r) return;
      const words = sentences[i].text.split(/\s+/).filter(Boolean);
      if (player.playing) {
        resume.current = true;
        player.stop();
      }
      setLookup({
        itemId,
        idx: sentences[i].idx,
        from: range[0],
        to: range[1],
        text: words.slice(range[0], range[1] + 1).join(" "),
        typed: "",
        sentence: sentences[i].text,
        rect: r.getBoundingClientRect(),
      });
    }, 0);
  };
  const closeLookup = useCallback(() => {
    setLookup(null);
    window.getSelection()?.removeAllRanges();
    if (resume.current) {
      resume.current = false;
      playFrom(at);
    }
  }, [playFrom, at]);
  const [saved, setSaved] = useState<string[]>([]);

  // Time listening: counted while playing, saved every few seconds and when playback stops or the page closes.
  const [today, setToday] = useState<number | null>(null);
  const pending = useRef(0);
  const flush = useCallback(() => {
    const s = pending.current;
    pending.current = 0;
    backend.listened(s).then(setToday, () => {});
  }, []);
  useEffect(() => {
    flush();
    return flush;
  }, [flush]);
  useEffect(() => {
    if (!player.playing) return;
    const t = window.setInterval(() => {
      pending.current += 1;
      if (pending.current >= SAVE_EVERY_S) flush();
    }, 1000);
    return () => {
      window.clearInterval(t);
      if (pending.current > 0) flush();
    };
  }, [player.playing, flush]);

  // Keeps the sentence being heard in the middle of the space under the player. Scrolling away pauses that;
  // it comes back by itself a few seconds after the scrolling stops, or at once on play, replay or ↑ ↓.
  const list = useRef<HTMLOListElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!follow || current < 0) return;
    const row = document.getElementById(`listen-${current}`);
    const scroller = row?.closest(".content");
    if (!row || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const top = bar.current?.getBoundingClientRect().bottom ?? view.top;
    const r = row.getBoundingClientRect();
    const off = (r.top + r.bottom) / 2 - (top + view.bottom) / 2;
    if (Math.abs(off) > 24) glide(scroller, off);
  }, [current, follow]);
  useEffect(() => {
    const scroller = list.current?.closest(".content");
    if (!scroller) return;
    let back = 0;
    const away = () => {
      stopGlide();
      setFollow(false);
      window.clearTimeout(back);
      back = window.setTimeout(() => setFollow(true), BACK_AFTER_MS);
    };
    // The scroll bar dragged, or the page keys.
    const onDown = (e: Event) => e.target === scroller && away();
    const onKey = (e: KeyboardEvent) => ["PageUp", "PageDown", "Home", "End"].includes(e.key) && away();
    scroller.addEventListener("wheel", away, { passive: true });
    scroller.addEventListener("touchmove", away, { passive: true });
    scroller.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(back);
      scroller.removeEventListener("wheel", away);
      scroller.removeEventListener("touchmove", away);
      scroller.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sentences.length > 0]);

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === " ") toggle();
    else if (k === "ArrowUp" || k === "ArrowDown") step(k === "ArrowUp" ? -1 : 1);
    else if (k === "ArrowLeft" || k === "ArrowRight") playFrom(pos + (k === "ArrowLeft" ? -5000 : 5000));
    else if (k.toLowerCase() === "r") replay();
    else if (k.toLowerCase() === "s" && e.shiftKey) setAllShown((a) => !a);
    else if (k.toLowerCase() === "s") toggleShown(current);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = item?.title ?? "…";
  const crumbs = [
    { label: "Library", to: "/library" },
    ...(show ? [{ label: show.title, to: `/podcasts/show/${show.id}` }] : []),
    { label: title, to: `/library/${itemId}` },
    "Listen",
  ];
  const actions = (
    <button type="button" className="btn btn-sm" onClick={() => navigate(dictationPath(itemId))}>
      Dictate instead
    </button>
  );
  const busy = isBusy(status?.state);
  const shownCount = allShown ? sentences.length : shown.size;

  return (
    <Page crumbs={crumbs} keys={KEYS} actions={actions}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <section aria-label="Listen" className="page" style={{ flexGrow: 1, minWidth: 0, gap: 16, paddingTop: 20 }}>
          {item && item.state !== "ready" && <div className="notice">This episode isn’t downloaded. Download it on its page first.</div>}

          {/* Stays at the top while the sentences scroll under it. */}
          <div ref={bar} style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--canvas)", padding: "12px 0", margin: "-12px 0" }}>
            <div className="panel" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={toggle}
                aria-label={player.playing ? "Pause" : "Play"}
                style={{ width: 36, height: 36, padding: 0, borderRadius: 9999 }}
                disabled={item?.state !== "ready"}
              >
                <Icon name={player.playing ? "pause" : "play"} size={14} stroke={player.playing ? 2.4 : 1.6} />
              </button>
              <button type="button" className="btn btn-ghost" onClick={replay} aria-label="Replay this sentence" title="Replay this sentence (R)" style={{ width: 32, padding: 0 }}>
                <Icon name="replay" size={15} stroke={1.8} />
              </button>
              <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13 }}>
                  {current >= 0 ? (
                    <>
                      <b style={{ fontWeight: 500, color: "var(--ink)" }}>Sentence {current + 1}</b>
                      <span className="mono" style={{ fontSize: 12 }}>
                        of {sentences.length}
                        {busy && " so far"}
                      </span>
                    </>
                  ) : (
                    <span>{sentences.length > 0 ? `${plural(sentences.length, "sentence")}` : busy ? "Transcribing…" : ""}</span>
                  )}
                  <span style={{ flexGrow: 1 }} />
                  <span className="mono" style={{ fontSize: 12 }}>
                    {clock(pos / 1000)} / {clock(item?.durationS)}
                  </span>
                </div>
                <input
                  className="scrub"
                  type="range"
                  min={0}
                  max={Math.max(1, durMs)}
                  step={1000}
                  value={Math.min(pos, durMs)}
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    setFollow(true);
                    if (player.playing) playFrom(ms);
                    else setAt(ms);
                  }}
                  aria-label="Position"
                  style={{ width: "100%", background: `linear-gradient(to right, var(--ink-muted) ${durMs ? (pos / durMs) * 100 : 0}%, var(--hairline) 0)` }}
                />
              </div>
              <div className="seg" role="group" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={speed === s}
                    onClick={() => {
                      setSpeed(s);
                      if (player.playing) playFrom(player.positionMs, s);
                    }}
                  >
                    {s === 1 ? "1.0" : s}×
                  </button>
                ))}
              </div>
            </div>
            {player.error && <p style={{ color: "var(--semantic-error)", marginTop: 8 }}>{player.error}</p>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="eyebrow">Sentences</h2>
            <span style={{ fontSize: 12 }}>
              {allShown ? "Select words to look them up." : "Hidden until you show them, to test your ears first. Select words in a shown sentence to look them up."}
            </span>
            <span style={{ flexGrow: 1 }} />
            <div className="seg" role="group" aria-label="Sentences">
              <button type="button" aria-pressed={!allShown} onClick={() => setAllShown(false)}>
                <Icon name="eye-off" size={13} />
                &nbsp;Hidden
              </button>
              <button type="button" aria-pressed={allShown} onClick={() => setAllShown(true)}>
                <Icon name="eye" size={13} />
                &nbsp;All shown
              </button>
            </div>
            <Kbd keys="Shift S" />
          </div>

          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
              <span className="track" style={{ width: 120 }}>
                <span className="fill" style={{ display: "block", width: `${Math.round(transcribed(status) * 100)}%` }} />
              </span>
              More sentences arrive as the episode is transcribed.
            </div>
          )}
          {status?.state === "failed" && (
            <div className="notice notice-error" role="alert">
              <span style={{ flexGrow: 1 }}>{status.error ?? "Transcription failed."}</span>
              <button type="button" className="btn btn-sm" onClick={() => backend.transcribe(itemId)}>
                Try again
              </button>
            </div>
          )}

          {sentences.length > 0 && (
            <ol ref={list} className="panel listen" aria-label="Sentences">
              {sentences.map((s, i) => {
                const on = i === current;
                const open = isShown(i);
                return (
                  <li key={s.idx} id={`listen-${i}`} className={on ? "lrow lrow-on" : "lrow"} aria-current={on ? "true" : undefined}>
                    <button type="button" className="lrow-num" onClick={() => playSentence(i)} aria-label={`Play sentence ${i + 1}`} title="Play from here">
                      {on && player.playing ? <span className="playing" aria-hidden="true"><i /><i /><i /></span> : i + 1}
                    </button>
                    <div className="lrow-body">
                      {open ? (
                        <span className="selectable" style={{ cursor: "text" }} onMouseUp={(e) => onSelect(i, e)}>
                          <IndexedText text={s.text} />
                        </span>
                      ) : (
                        <span className="bars" role="img" aria-label="Hidden sentence" onClick={() => playSentence(i)}>
                          {s.text
                            .split(/\s+/)
                            .filter(Boolean)
                            .map((w, k) => (
                              <i key={k} className={on && k < heard ? "heard" : undefined} style={{ width: Math.min(120, w.replace(/[^\p{L}\p{N}']/gu, "").length * 7 + 6) }} />
                            ))}
                        </span>
                      )}
                    </div>
                    <div className="lrow-end">
                      {!allShown && (
                        <button
                          type="button"
                          className={on && !open ? "btn btn-sm peek" : "btn btn-sm btn-ghost peek"}
                          onClick={() => toggleShown(i)}
                          aria-label={`${open ? "Hide" : "Show"} sentence ${i + 1}`}
                        >
                          <Icon name={open ? "eye-off" : "eye"} size={13} />
                          {open ? "Hide" : "Show"}
                          {on && <Kbd keys="S" />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="insp" aria-label="Words">
          {lookup ? (
            <LookupCard key={`${lookup.idx}-${lookup.from}-${lookup.to}`} sel={lookup} path={item?.path ?? null} docked onClose={closeLookup} onSaved={(t) => setSaved((s) => (s.includes(t) ? s : [...s, t]))} />
          ) : (
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              Show a sentence, then select a word or phrase in it to see its meaning and save it to My words. Playback pauses while you look, and carries on
              when you close the card.
            </p>
          )}
          {saved.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="eyebrow">Saved while listening</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {saved.map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ flexGrow: 1 }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="prop">
              Shown so far
              <b className="mono">{allShown ? "All" : `${shownCount} of ${sentences.length}`}</b>
            </div>
            <div className="prop">
              Listened today
              <b className="mono">{today === null ? "—" : `${Math.round(today / 60)} min`}</b>
            </div>
          </div>
        </aside>
      </div>
    </Page>
  );
}

let gliding = 0;

/** Stops a glide under way, so the learner's own scrolling wins. */
function stopGlide() {
  cancelAnimationFrame(gliding);
  gliding = 0;
}

/** Scrolls `el` by `by` px gently: a short move to the next sentence takes about half a second, a long way
 * back after the learner scrolled away up to 1.6 seconds, easing in and out. */
function glide(el: Element, by: number) {
  stopGlide();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.scrollTop += by;
    return;
  }
  const from = el.scrollTop;
  const ms = Math.min(1600, 450 + Math.abs(by) * 1.2);
  const start = performance.now();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.scrollTop = from + by * ease(t);
    gliding = t < 1 ? requestAnimationFrame(step) : 0;
  };
  gliding = requestAnimationFrame(step);
}
