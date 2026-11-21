// Listen (design D07, DESIGN.md "Listen"): the episode straight through, with its sentences hidden until the
// learner shows them, to test their ears before their eyes. A shown sentence stays shown; select words in it to
// look them up and save them. Time listening counts towards the streak, like dictation.
// A video of the learner's own is the same page, called Watch: the picture plays above the sentences, with the
// sentence being said as a subtitle on it. The mouse on the subtitle pauses the video, so its words can be picked.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { AskPanel } from "../components/Ask";
import { Icon } from "../components/Icon";
import { LookupCard, type Selection } from "../components/LookupCard";
import { IndexedText, selectedWords } from "../components/Marks";
import { Kbd, Page } from "../components/Shell";
import { useAi } from "../lib/ai";
import { backend, type Item, type Sentence, type Show, type TranscriptStatus } from "../lib/backend";
import { dictationPath } from "../lib/dictation";
import { useLibraryChanged } from "../lib/downloads";
import { clock, plural } from "../lib/format";
import { sentenceAt, SPEEDS, usePlayer } from "../lib/playback";
import { isBusy, transcribed, useTranscript } from "../lib/transcripts";
import { t } from "../lib/i18n";
import { isVideo, makeThumbnail, useVideoPlayer, useVideoSrc } from "../lib/video";

export const listenPath = (itemId: number) => `/library/${itemId}/listen`;

const KEYS: [string, string][] = [
  ["Space", "Play"],
  ["↑ ↓", "Sentence"],
  ["S", "Show this one"],
  ["Shift S", "Show all"],
  ["R", "Replay"],
  ["?", "Ask about it"],
];

/** Within this long of a sentence's start, Replay and ↑ go to the sentence before. */
const RESTART_MS = 1200;
/** Left less than this far in, or this close to the end, it starts from the beginning next time. */
const RESUME_MIN_MS = 5000;
const RESUME_END_MS = 15000;
/** Listening time is saved this often while playing, and when playback stops. */
const SAVE_EVERY_S = 15;
/** After the learner scrolls away, the sentence being heard comes back to the middle this long after they stop. */
const BACK_AFTER_MS = 2500;

/** A fresh page for each episode, so going straight from one to another (search, My words) starts clean. */
export function ListenScreen() {
  return <ListenPage key={useParams().itemId} />;
}

function ListenPage() {
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setLoadError(null);
    setAttempt((a) => a + 1);
  };
  useEffect(() => {
    backend.transcriptStatus(itemId).then(setInitial, () => setLoadError("Couldn't load the transcript."));
  }, [itemId, attempt]);
  const status = useTranscript(itemId, initial);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const count = status?.sentences ?? 0;
  useEffect(() => {
    if (count > 0) backend.sentences(itemId).then(setSentences, () => setLoadError("Couldn't load the transcript."));
  }, [itemId, count, attempt]);
  // No transcript yet: start it, as dictation does. The audio plays meanwhile.
  const asked = useRef(false);
  useEffect(() => {
    if (item?.state === "ready" && status?.state === "none" && !asked.current) {
      asked.current = true;
      backend.transcribe(itemId);
    }
  }, [item?.state, status?.state, itemId]);

  const video = isVideo(item);
  const src = useVideoSrc(itemId, video);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // A video with no thumbnail yet gets one, shown before it plays and in the Library.
  useEffect(() => {
    if (video && item?.state === "ready" && !item.artworkUrl) makeThumbnail(itemId);
  }, [video, item?.state, item?.artworkUrl, itemId]);
  const audio = usePlayer(item?.state === "ready" && !video ? item.path : null);
  const film = useVideoPlayer(videoEl);
  const player = video ? film : audio;
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
  // Listen starts playing as soon as it opens; Watch shows the video's thumbnail and waits for Play. Both carry on
  // from where they were left last time (or the sentence opened from My words), with Start over beside it.
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !item || item.state !== "ready" || !item.path) return;
    started.current = true;
    const left = item.listenMs;
    const resume = left > RESUME_MIN_MS && (!durMs || left < durMs - RESUME_END_MS) ? left : 0;
    const from = startAt ?? resume;
    if (startAt === null && resume > 0) setResumedFrom(resume);
    if (video) setAt(from);
    else playFrom(from);
  }, [item, video, startAt, durMs, playFrom]);
  const startOver = () => {
    setResumedFrom(null);
    setFollow(true);
    if (video && !player.playing) setAt(0);
    else playFrom(0);
  };
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
  // The mouse on a video's subtitle pauses it, so the line stays while a word is picked; moving away carries on.
  const [held, setHeld] = useState(false);
  const holdSubtitle = () => {
    if (!player.playing) return;
    player.stop();
    setHeld(true);
  };
  const releaseSubtitle = () => {
    if (!held) return;
    setHeld(false);
    if (!lookup && asking === null) playFrom(pos);
  };
  const onSelect = (i: number, e: MouseEvent<HTMLElement>) => {
    const root = e.currentTarget;
    window.setTimeout(() => {
      const range = selectedWords(root);
      const r = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (!range || !r) return;
      const words = sentences[i].text.split(/\s+/).filter(Boolean);
      if (player.playing || held) {
        resume.current = true;
        player.stop();
        setHeld(false);
      }
      setAsking(null);
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
      // The picked words are marked in the subtitle and in the sentence list alike, instead of the selection.
      if (video) window.getSelection()?.removeAllRanges();
    }, 0);
  };
  // Asking the AI about a sentence (design D17) also pauses playback, in the same side panel.
  const [asking, setAsking] = useState<number | null>(null);
  const { status: ai } = useAi();
  const openAsk = (i: number) => {
    if (i < 0 || !sentences[i]) return;
    if (!isShown(i)) toggleShown(i);
    if (player.playing || held) {
      resume.current = true;
      player.stop();
      setHeld(false);
    }
    setLookup(null);
    setAsking(i);
  };
  const closeAsk = () => {
    setAsking(null);
    if (resume.current) {
      resume.current = false;
      if (!player.playing) playFrom(at);
    }
  };
  const closeLookup = useCallback(() => {
    setLookup(null);
    window.getSelection()?.removeAllRanges();
    if (resume.current) {
      resume.current = false;
      if (!player.playing) playFrom(at);
    }
  }, [playFrom, at, player.playing]);
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
  // Where it was left, saved with the listening time and whenever playback stops (the page closing too).
  // Near the end counts as finished: next time starts from the beginning.
  const posRef = useRef(0);
  posRef.current = pos;
  const durRef = useRef(0);
  durRef.current = durMs;
  const savePosition = useCallback(() => {
    const ms = posRef.current;
    const done = durRef.current > 0 && ms > durRef.current - RESUME_END_MS;
    backend.saveListenPosition(itemId, done ? 0 : ms).catch(() => {});
  }, [itemId]);
  useEffect(() => {
    if (!player.playing) return;
    const t = window.setInterval(() => {
      pending.current += 1;
      if (pending.current >= SAVE_EVERY_S) {
        flush();
        savePosition();
      }
    }, 1000);
    return () => {
      window.clearInterval(t);
      if (pending.current > 0) flush();
      savePosition();
    };
  }, [player.playing, flush, savePosition]);

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

  // The sentence rows only change when their own props do: playback moves on many times a second, and a long
  // episode has well over a thousand of them.
  const act = useRef<RowActions | null>(null);
  act.current = { play: playSentence, select: onSelect, toggle: toggleShown, ask: openAsk };
  const rowActions = useMemo<RowActions>(
    () => ({
      play: (i) => act.current?.play(i),
      select: (i, e) => act.current?.select(i, e),
      toggle: (i) => act.current?.toggle(i),
      ask: (i) => act.current?.ask(i),
    }),
    [],
  );

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
    else if (k === "?" || (e.shiftKey && e.code === "Slash")) openAsk(Math.max(0, current));
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
    video ? "Watch" : "Listen",
  ];
  const actions = (
    <button type="button" className="btn btn-sm" onClick={() => navigate(dictationPath(itemId))}>
      {t("Dictate instead")}
    </button>
  );
  const busy = isBusy(status?.state);
  // The subtitle: the sentence being said, gone in a long pause after it.
  const line = video && current >= 0 && sentences[current] && pos <= sentences[current].endMs + 1500 ? current : -1;
  const picked = (idx: number): [number, number] | null => (lookup && lookup.idx === idx ? [lookup.from, lookup.to] : null);
  const shownCount = allShown ? sentences.length : shown.size;

  return (
    <Page crumbs={crumbs} keys={KEYS} actions={actions}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <section aria-label={t(video ? "Watch" : "Listen")} className="page" style={{ flexGrow: 1, minWidth: 0, gap: 16, paddingTop: 20 }}>
          {item && item.state === "missing" && (
            <div className="notice notice-error" role="alert">
              {t("This file is no longer at {path}. Move it back, or remove it from the Library and add it again.", { path: item.path ?? "" })}
            </div>
          )}
          {item && item.state !== "ready" && item.state !== "missing" && <div className="notice">{t("This episode isn’t downloaded. Download it on its page first.")}</div>}
          {loadError && (
            <div className="notice notice-error" role="alert">
              <span style={{ flexGrow: 1 }}>{t(loadError)}</span>
              <button type="button" className="btn btn-sm" onClick={retry}>
                {t("Try again")}
              </button>
            </div>
          )}

          {/* Stays at the top while the sentences scroll under it. */}
          <div ref={bar} style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--canvas)", padding: "12px 0", margin: "-12px 0" }}>
            {video && (
              <div className="video">
                <video ref={setVideoEl} src={src ?? undefined} poster={item?.artworkUrl ?? undefined} preload="auto" playsInline onClick={toggle} />
                {!player.playing && !held && !lookup && (
                  <button type="button" className="video-play" onClick={toggle} aria-label={t("Play")}>
                    <Icon name="play" size={26} stroke={1.6} />
                  </button>
                )}
                {held && (
                  <div className="video-held">
                    <Icon name="pause" size={12} stroke={2.2} />
                    {t("Paused while you look")}
                  </div>
                )}
                {line >= 0 && (
                  <div className="subtitle">
                    {isShown(line) ? (
                      <p className="selectable" onMouseEnter={holdSubtitle} onMouseLeave={releaseSubtitle} onMouseUp={(e) => onSelect(line, e)}>
                        <Words text={sentences[line].text} picked={picked(sentences[line].idx)} />
                      </p>
                    ) : (
                      <p className="subtitle-hidden" onClick={() => toggleShown(line)} role="button" aria-label={t("Show this subtitle")}>
                        <span className="bars" aria-hidden="true">
                          {sentences[line].text
                            .split(/\s+/)
                            .filter(Boolean)
                            .map((w, k) => (
                              <i key={k} className={k < heard ? "heard" : undefined} style={{ width: Math.min(120, w.replace(/[^\p{L}\p{N}']/gu, "").length * 7 + 6) }} />
                            ))}
                        </span>
                        <span>{t("Press S to show")}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="panel" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={toggle}
                aria-label={t(player.playing ? "Pause" : "Play")}
                style={{ width: 36, height: 36, padding: 0, borderRadius: 9999 }}
                disabled={item?.state !== "ready"}
              >
                <Icon name={player.playing ? "pause" : "play"} size={14} stroke={player.playing ? 2.4 : 1.6} />
              </button>
              <button type="button" className="btn btn-ghost" onClick={replay} aria-label={t("Replay this sentence")} title={t("Replay this sentence (R)")} style={{ width: 32, padding: 0 }}>
                <Icon name="replay" size={15} stroke={1.8} />
              </button>
              <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {current >= 0 ? (
                    <>
                      <b style={{ fontWeight: 500, color: "var(--ink)" }}>{t("Sentence {n}", { n: current + 1 })}</b>
                      <span className="mono" style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t(busy ? "of {n} so far" : "of {n}", { n: sentences.length })}
                      </span>
                    </>
                  ) : (
                    <span>{sentences.length > 0 ? plural(sentences.length, "sentence") : busy ? t("Transcribing…") : ""}</span>
                  )}
                  <span style={{ flexGrow: 1 }} />
                  <span className="mono" style={{ fontSize: 12, flexShrink: 0 }}>
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
                  aria-label={t("Position")}
                  style={{ width: "100%", background: `linear-gradient(to right, var(--ink-muted) ${durMs ? (pos / durMs) * 100 : 0}%, var(--hairline) 0)` }}
                />
              </div>
              <div className="seg" role="group" aria-label={t("Speed")}>
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
            {player.error && <p style={{ color: "var(--semantic-error)", marginTop: 8 }}>{t(player.error)}</p>}
            {resumedFrom !== null && (
              <div className="resumed">
                {t("Picking up from {time}, where you stopped last time.", { time: clock(resumedFrom / 1000) })}
                <button type="button" className="btn btn-sm btn-ghost" onClick={startOver}>
                  <Icon name="replay" size={13} />
                  {t("Start over")}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="eyebrow">{t("Sentences")}</h2>
            <span style={{ fontSize: 12 }}>
              {t(allShown ? "Select words to look them up." : "Hidden until you show them, to test your ears first. Select words in a shown sentence to look them up.")}
            </span>
            <span style={{ flexGrow: 1 }} />
            <div className="seg" role="group" aria-label={t("Sentences")}>
              <button type="button" aria-pressed={!allShown} onClick={() => setAllShown(false)}>
                <Icon name="eye-off" size={13} />
                &nbsp;{t("Hidden")}
              </button>
              <button type="button" aria-pressed={allShown} onClick={() => setAllShown(true)}>
                <Icon name="eye" size={13} />
                &nbsp;{t("All shown")}
              </button>
            </div>
            <Kbd keys="Shift S" />
          </div>

          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
              <span className="track" style={{ width: 120 }}>
                <span className="fill" style={{ display: "block", width: `${Math.round(transcribed(status) * 100)}%` }} />
              </span>
              {t(video ? "More sentences arrive as the video is transcribed." : "More sentences arrive as the episode is transcribed.")}
            </div>
          )}
          {status?.state === "failed" && (
            <div className="notice notice-error" role="alert">
              <span style={{ flexGrow: 1 }}>{t(status.error ?? "Transcription failed.")}</span>
              <button type="button" className="btn btn-sm" onClick={() => backend.transcribe(itemId)}>
                {t("Try again")}
              </button>
            </div>
          )}

          {sentences.length > 0 && (
            <ol ref={list} className="panel listen" aria-label={t("Sentences")}>
              {sentences.map((s, i) => {
                const on = i === current;
                const p = picked(s.idx);
                return (
                  <Row
                    key={s.idx}
                    s={s}
                    i={i}
                    on={on}
                    open={isShown(i)}
                    playing={on && player.playing}
                    heard={on ? heard : 0}
                    pickFrom={video && p ? p[0] : -1}
                    pickTo={video && p ? p[1] : -1}
                    video={video}
                    allShown={allShown}
                    canAsk={!!ai?.using}
                    act={rowActions}
                  />
                );
              })}
            </ol>
          )}
        </section>

        <aside className="insp" aria-label={t("Words")}>
          {asking !== null && sentences[asking] ? (
            <AskPanel
              key={sentences[asking].idx}
              itemId={itemId}
              attemptId={null}
              idx={sentences[asking].idx}
              sentence={sentences[asking].text}
              typed=""
              mistakes={false}
              onPlaySlowly={null}
              onClose={closeAsk}
              docked
            />
          ) : lookup ? (
            <LookupCard key={`${lookup.idx}-${lookup.from}-${lookup.to}`} sel={lookup} path={item?.path ?? null} docked onClose={closeLookup} onSaved={(t) => setSaved((s) => (s.includes(t) ? s : [...s, t]))} />
          ) : (
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              {t(
                video
                  ? "Show a subtitle, then click a word or drag across a phrase, on the video or in the sentences below, to see its meaning and save it to My words. The video pauses while your mouse is on the subtitle, and carries on when you move away."
                  : "Show a sentence, then select a word or phrase in it to see its meaning and save it to My words. Playback pauses while you look, and carries on when you close the card.",
              )}
            </p>
          )}
          {saved.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="eyebrow">{t(video ? "Saved while watching" : "Saved while listening")}</div>
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
              {t("Shown so far")}
              <b className="mono">{allShown ? t("All") : t("{a} of {b}", { a: shownCount, b: sentences.length })}</b>
            </div>
            <div className="prop">
              {t(video ? "Watched today" : "Listened today")}
              <b className="mono">{today === null ? "—" : t("{n} min", { n: Math.round(today / 60) })}</b>
            </div>
          </div>
        </aside>
      </div>
    </Page>
  );
}

type RowActions = {
  play: (i: number) => void;
  select: (i: number, e: MouseEvent<HTMLElement>) => void;
  toggle: (i: number) => void;
  ask: (i: number) => void;
};

type RowProps = {
  s: Sentence;
  i: number;
  on: boolean;
  open: boolean;
  playing: boolean;
  heard: number;
  pickFrom: number;
  pickTo: number;
  video: boolean;
  allShown: boolean;
  canAsk: boolean;
  act: RowActions;
};

/** One sentence in the list. */
const Row = memo(function Row({ s, i, on, open, playing, heard, pickFrom, pickTo, video, allShown, canAsk, act }: RowProps) {
  return (
    <li id={`listen-${i}`} className={on ? "lrow lrow-on" : "lrow"} aria-current={on ? "true" : undefined}>
      <button type="button" className="lrow-num" onClick={() => act.play(i)} aria-label={t("Play sentence {n}", { n: i + 1 })} title={t("Play from here")}>
        {playing ? <span className="playing" aria-hidden="true"><i /><i /><i /></span> : i + 1}
      </button>
      <div className="lrow-body">
        {open ? (
          <span className="selectable" style={{ cursor: "text" }} onMouseUp={(e) => act.select(i, e)}>
            {video ? <Words text={s.text} picked={pickFrom >= 0 ? [pickFrom, pickTo] : null} /> : <IndexedText text={s.text} />}
          </span>
        ) : (
          <span className="bars" role="img" aria-label={t("Hidden sentence")} onClick={() => act.play(i)}>
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
        {on && open && canAsk && (
          <button type="button" className="btn btn-sm btn-ghost peek" onClick={() => act.ask(i)} aria-label={t("Ask about sentence {n}", { n: i + 1 })} title={t("Ask the AI about this sentence (?)")}>
            <Icon name="chat" size={13} />
            {t("Ask")}
          </button>
        )}
        {!allShown && (
          <button
            type="button"
            className={on && !open ? "btn btn-sm peek" : "btn btn-sm btn-ghost peek"}
            onClick={() => act.toggle(i)}
            aria-label={t(open ? "Hide sentence {n}" : "Show sentence {n}", { n: i + 1 })}
          >
            <Icon name={open ? "eye-off" : "eye"} size={13} />
            {t(open ? "Hide" : "Show")}
            {on && <Kbd keys="S" />}
          </button>
        )}
      </div>
    </li>
  );
});

/** A sentence's words, numbered for selecting like `IndexedText`, with the ones picked for the word card marked. */
function Words({ text, picked }: { text: string; picked: [number, number] | null }) {
  return (
    <span className="marked">
      {text
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => (
          <span key={i}>
            {i > 0 && " "}
            <span data-i={i} className={picked && i >= picked[0] && i <= picked[1] ? "picked" : undefined}>
              {w}
            </span>
          </span>
        ))}
    </span>
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
