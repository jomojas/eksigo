// The Episode page, the same from Podcasts and from the Library: download it, preview it, and (from day 4)
// start dictation. A learner's own file has the same page without the podcast parts.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";
import { backend, type Episode, type Item, type Sentence, type Show, type TranscriptStatus } from "../lib/backend";
import { fraction, useDownloads, useLibraryChanged } from "../lib/downloads";
import { bytes, clock, shortDate, whenDay } from "../lib/format";
import { SPEEDS, usePlayer } from "../lib/playback";
import { isBusy, transcribed, useActivity, useTranscript } from "../lib/transcripts";

type Data = { episode: Episode | null; show: Show | null; item: Item | null };

/** `/podcasts/episode/:episodeId` or `/library/:itemId`. */
export function EpisodeScreen({ from }: { from: "podcasts" | "library" }) {
  const params = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (from === "podcasts") {
        const p = await backend.getEpisode(Number(params.episodeId));
        setData(p);
      } else {
        const item = await backend.item(Number(params.itemId));
        if (item.episodeId) {
          const p = await backend.getEpisode(item.episodeId);
          setData({ ...p, item });
        } else setData({ episode: null, show: null, item });
      }
      setError(null);
    } catch (e) {
      // Removed from the Library while open: go back to it.
      if (from === "library") navigate("/library", { replace: true });
      else setError(String(e));
    }
  }, [from, params.episodeId, params.itemId, navigate]);

  useEffect(() => {
    load();
  }, [load]);
  useLibraryChanged(load);

  const { episode, show, item } = data ?? { episode: null, show: null, item: null };
  const title = episode?.title ?? item?.title ?? "…";
  const crumbs =
    from === "library"
      ? [{ label: "Library", to: "/library" }, ...(show ? [{ label: show.title, to: `/podcasts/show/${show.id}` }] : []), title]
      : [{ label: "Podcasts", to: "/podcasts" }, ...(show ? [{ label: show.title, to: `/podcasts/show/${show.id}` }] : []), title];

  const ready = item?.state === "ready" && item.path;

  return (
    <Page crumbs={crumbs} keys={ready ? [["Space", "Play"], ["← →", "5 seconds"], ["R", "Replay"]] : []}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <div className="page" style={{ flexGrow: 1, minWidth: 0, gap: 26 }}>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          {data && (
            <>
              <header style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                <Art url={episode?.artworkUrl ?? item?.artworkUrl ?? null} size={96} radius={10} file={!!item?.ownFile} />
                <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="eyebrow">
                    {show ? `${show.title} · ${shortDate(episode?.publishedAt)}` : `My files · added ${whenDay(item?.addedAt)}`}
                  </div>
                  <h1 className="h1 selectable" style={{ fontSize: 26, letterSpacing: -0.6, maxWidth: 820 }}>
                    {title}
                  </h1>
                  <div style={{ fontSize: 12 }} className="mono">
                    {clock(item?.durationS ?? episode?.durationS)}
                  </div>
                </div>
              </header>

              <Actions episode={episode} item={item} onChange={load} onError={setError} />

              {ready && <Listen item={item} durationS={item.durationS ?? episode?.durationS ?? null} />}

              {episode?.description && (
                <section aria-labelledby="about">
                  <h2 id="about" className="eyebrow" style={{ marginBottom: 8 }}>
                    About this episode
                  </h2>
                  <p className="selectable" style={{ fontSize: 14, lineHeight: 1.6 }}>
                    {episode.description}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
        {data && <Details episode={episode} item={item} onRemoved={() => (from === "library" ? navigate("/library") : load())} />}
      </div>
    </Page>
  );
}

function Actions({ episode, item, onChange, onError }: { episode: Episode | null; item: Item | null; onChange: () => void; onError: (e: string) => void }) {
  const progress = useDownloads().get(item?.id ?? -1);

  const download = async () => {
    if (!episode) return;
    try {
      await backend.download(episode.id);
      onChange();
    } catch (e) {
      onError(String(e));
    }
  };

  if (!item) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" className="btn btn-primary" onClick={download}>
          <Icon name="download" size={14} stroke={1.8} />
          Download{episode?.audioBytes ? ` · ${bytes(episode.audioBytes)}` : ""}
        </button>
        <span style={{ fontSize: 12 }}>Downloaded episodes stay in your Library until you remove them.</span>
      </div>
    );
  }

  if (item.state === "downloading") {
    const f = fraction(progress);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="track" style={{ width: 240 }} role="progressbar" aria-valuenow={f === null ? undefined : Math.round(f * 100)} aria-label="Download">
          <span className="fill" style={{ display: "block", width: `${Math.round((f ?? 0) * 100)}%` }} />
        </span>
        <span className="mono" style={{ fontSize: 12 }}>
          {progress ? `${bytes(progress.received)}${progress.total ? ` of ${bytes(progress.total)}` : ""}` : "Starting…"}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => backend.cancelDownload(item.id)}>
          Cancel
        </button>
      </div>
    );
  }

  if (item.state === "failed") {
    return (
      <div className="notice notice-error" role="alert">
        <span style={{ flexGrow: 1 }}>{item.error ?? "The download failed."}</span>
        <button type="button" className="btn btn-sm" onClick={download}>
          Try again
        </button>
      </div>
    );
  }

  if (item.state === "missing") {
    return (
      <div className="notice notice-error" role="alert">
        This file is no longer at {item.path}. Move it back, or remove it from the Library and add it again.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="btn btn-primary" disabled title="Dictation arrives on day 4">
        Start dictation
      </button>
      <span className="badge badge-next">Arrives day 4</span>
    </div>
  );
}

/** Where `ms` is in the transcript: the last sentence starting at or before it, or -1. */
function sentenceAt(sentences: Sentence[], ms: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Past the last sentence written so far (the transcript is still growing): no sentence.
  if (found === sentences.length - 1 && found >= 0 && ms > sentences[found].endMs + 2000) return -1;
  return found;
}

/** Back this far into a sentence, "Replay sentence" goes to the one before instead, like a music player. */
const RESTART_MS = 1200;

/**
 * Listening to the episode: one player for the Preview card and the transcript. Clicking a sentence plays the
 * episode from there; the sentence being heard is highlighted and kept in view.
 */
function Listen({ item, durationS }: { item: Item; durationS: number | null }) {
  const player = usePlayer(item.path);
  const [speed, setSpeed] = useState(1);
  const [at, setAt] = useState(0);
  const durMs = (durationS ?? 0) * 1000;
  const pos = player.playing ? player.positionMs : at;

  const [initial, setInitial] = useState<TranscriptStatus | null>(null);
  const live = useTranscript(item.id, initial);
  // Stop looks done the moment it's clicked; the core confirms a moment later.
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (live && !isBusy(live.state)) setStopping(false);
  }, [live]);
  const status = live && stopping && isBusy(live.state) ? { ...live, state: "none" as const, sentences: 0, doneMs: 0 } : live;
  const stop = useCallback(() => {
    setStopping(true);
    backend.cancelTranscript(item.id);
  }, [item.id]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  useEffect(() => {
    backend.transcriptStatus(item.id).then(setInitial);
  }, [item.id]);
  // New sentences arrive a chunk at a time.
  const count = status?.sentences ?? 0;
  useEffect(() => {
    if (count > 0) backend.sentences(item.id).then(setSentences);
    else setSentences([]);
  }, [item.id, count]);
  const current = sentenceAt(sentences, pos);

  // While playing, remember where we are, so pausing and playing again carries on.
  useEffect(() => {
    if (player.playing) setAt(player.positionMs);
  }, [player.playing, player.positionMs]);

  // Whether the transcript keeps the sentence being heard in view. Scrolling away stops it.
  const [follow, setFollow] = useState(true);
  const sticky = useRef<HTMLDivElement>(null);

  const playFrom = useCallback(
    (ms: number, s = speed) => {
      const start = Math.max(0, Math.min(ms, durMs ? durMs - 500 : ms));
      setAt(start);
      player.play(start, null, s);
    },
    [player, speed, durMs],
  );

  const toggle = useCallback(() => {
    if (player.playing) return player.stop();
    setFollow(true);
    playFrom(at >= durMs - 500 && durMs ? 0 : at);
  }, [player, playFrom, at, durMs]);

  const jump = useCallback(
    (delta: number) => {
      const target = Math.max(0, pos + delta);
      if (player.playing) playFrom(target);
      else setAt(target);
    },
    [player.playing, playFrom, pos],
  );

  /** The start of the sentence being heard, or of the one before when it has only just begun; else 5 s back. */
  const replay = useCallback(() => {
    setFollow(true);
    if (current < 0) return playFrom(Math.max(0, pos - 5000));
    const s = sentences[current];
    const prev = sentences[current - 1];
    playFrom(pos - s.startMs < RESTART_MS && prev ? prev.startMs : s.startMs);
  }, [current, sentences, pos, playFrom]);

  const pick = useCallback(
    (i: number) => {
      setFollow(true);
      playFrom(sentences[i].startMs);
    },
    [sentences, playFrom],
  );

  /** Scrolls the transcript so sentence `i` sits a third of the way down the space under the Preview card. */
  const reveal = useCallback((i: number, always = false) => {
    const row = document.getElementById(`sentence-${i}`);
    const scroller = row?.closest(".content");
    if (!row || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const top = view.top + (sticky.current?.getBoundingClientRect().height ?? 0);
    const r = row.getBoundingClientRect();
    if (!always && r.top >= top + 24 && r.bottom <= view.bottom - 48) return;
    scroller.scrollBy({ top: r.top - (top + (view.bottom - top) / 3), behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (follow && player.playing && current >= 0) reveal(current);
  }, [current, follow, player.playing, reveal]);

  // The learner scrolling (wheel, trackpad, scroll bar, page keys) stops the following.
  useEffect(() => {
    const scroller = sticky.current?.closest(".content");
    if (!scroller) return;
    const away = () => setFollow(false);
    const onDown = (e: Event) => e.target === scroller && away();
    const onKey = (e: KeyboardEvent) => ["PageUp", "PageDown", "Home", "End"].includes(e.key) && away();
    scroller.addEventListener("wheel", away, { passive: true });
    scroller.addEventListener("touchmove", away, { passive: true });
    scroller.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      scroller.removeEventListener("wheel", away);
      scroller.removeEventListener("touchmove", away);
      scroller.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        jump(e.key === "ArrowLeft" ? -5000 : 5000);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        replay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, jump, replay]);

  const hasSentences = sentences.length > 0;
  return (
    <>
      {/* Stays at the top while the transcript scrolls under it. */}
      <div ref={sticky} style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--canvas)", padding: "12px 0", margin: "-12px 0" }}>
        <section aria-labelledby="preview" className="panel" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 id="preview" className="eyebrow" style={{ flexGrow: 1 }}>
              Preview
            </h2>
            {!follow && player.playing && current >= 0 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setFollow(true);
                  reveal(current, true);
                }}
              >
                Show current sentence
              </button>
            )}
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="btn" onClick={toggle} aria-label={player.playing ? "Pause" : "Play"} style={{ width: 36, padding: 0 }}>
              <Icon name={player.playing ? "pause" : "play"} size={14} stroke={player.playing ? 2.4 : 1.6} />
            </button>
            <span className="mono" style={{ fontSize: 12, width: 48, textAlign: "right" }}>
              {clock(pos / 1000)}
            </span>
            <input
              className="scrub"
              type="range"
              min={0}
              max={Math.max(1, durMs)}
              step={1000}
              value={Math.min(pos, durMs)}
              onChange={(e) => {
                const ms = Number(e.target.value);
                if (player.playing) playFrom(ms);
                else setAt(ms);
              }}
              aria-label="Position"
              style={{ flexGrow: 1, background: `linear-gradient(to right, var(--ink-muted) ${durMs ? (pos / durMs) * 100 : 0}%, var(--hairline) 0)` }}
            />
            <span className="mono" style={{ fontSize: 12, width: 48 }}>
              {clock(durationS)}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={replay}
              title={hasSentences ? "Play the current sentence again from its start" : "Go back 5 seconds"}
            >
              <Icon name="replay" size={13} stroke={1.8} />
              {hasSentences ? "Replay sentence" : "Back 5 s"}
            </button>
          </div>
          {player.error && <p style={{ color: "var(--semantic-error)" }}>{player.error}</p>}
          <p style={{ fontSize: 12 }}>
            <Kbd keys="Space" /> play or pause · <Kbd keys="←" /> <Kbd keys="→" /> 5 seconds · <Kbd keys="R" />{" "}
            {hasSentences ? "replay the sentence" : "back 5 seconds"}. Slower speeds keep the voice at its normal pitch.
          </p>
        </section>
      </div>
      <Transcript
        status={status}
        sentences={sentences}
        current={current}
        onPick={pick}
        onStop={stop}
        onStart={() => {
          setStopping(false);
          backend.transcribe(item.id);
        }}
      />
    </>
  );
}

function transcriptLabel(state: string | undefined): string {
  switch (state) {
    case "done":
      return "Whisper Fast";
    case "running":
    case "queued":
    case "model":
      return "In progress";
    case "failed":
      return "Failed";
    default:
      return "Not yet";
  }
}

/** The transcript: start it, watch it grow, and click any sentence to listen from there. */
function Transcript({
  status,
  sentences,
  current,
  onPick,
  onStop,
  onStart,
}: {
  status: TranscriptStatus | null;
  sentences: Sentence[];
  current: number;
  onPick: (i: number) => void;
  onStop: () => void;
  onStart: () => void;
}) {
  const { model } = useActivity();
  if (!status) return null;
  const f = transcribed(status);
  const busy = isBusy(status.state);
  const minutes = (ms: number | null) => (ms ? Math.max(1, Math.round(ms / 60_000)) : 0);
  // A click that ends a text selection selects; it doesn't jump.
  const picked = (i: number) => {
    if (window.getSelection()?.toString()) return;
    onPick(i);
  };

  return (
    <section aria-labelledby="transcript" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 28 }}>
        <h2 id="transcript" className="eyebrow" style={{ flexGrow: 1 }}>
          Transcript
        </h2>
      </div>

      {status.state === "none" && (
        <div className="panel" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <p style={{ flexGrow: 1, lineHeight: 1.5 }}>
            Eksigo writes out the episode on this computer, sentence by sentence, so dictation can play one sentence at a time. It takes a
            few seconds to start; you can listen to the sentences as they arrive.
          </p>
          <button type="button" className="btn" onClick={onStart}>
            Transcribe
          </button>
        </div>
      )}

      {busy && (
        <div className="panel" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          {status.state === "model" && model ? (
            <>
              <span className="track" style={{ width: 160 }}>
                <span className="fill" style={{ display: "block", width: `${Math.round((model.received / model.total) * 100)}%` }} />
              </span>
              <span style={{ flexGrow: 1 }}>
                Downloading the speech model, once · {bytes(model.received)} of {bytes(model.total)}
              </span>
            </>
          ) : status.state === "running" ? (
            <>
              <span className="track" style={{ width: 160 }}>
                <span className="fill" style={{ display: "block", width: `${Math.round(f * 100)}%` }} />
              </span>
              <span style={{ flexGrow: 1 }}>
                {minutes(status.doneMs)} of {minutes(status.durationMs)} min · {status.sentences} sentences so far
              </span>
            </>
          ) : (
            <span style={{ flexGrow: 1 }}>{status.state === "model" ? "Getting the speech model ready…" : "Waiting for another episode to finish…"}</span>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onStop}>
            Stop
          </button>
        </div>
      )}

      {status.state === "failed" && (
        <div className="notice notice-error" role="alert">
          <span style={{ flexGrow: 1 }}>{status.error ?? "Transcription failed."}</span>
          <button type="button" className="btn btn-sm" onClick={onStart}>
            Try again
          </button>
        </div>
      )}

      {status.state === "done" && (
        <p style={{ fontSize: 12 }}>{status.sentences} sentences · transcribed on this computer with Whisper Fast. Click a sentence to listen from there.</p>
      )}

      {sentences.length > 0 && (
        <ol className="panel selectable" style={{ listStyle: "none", margin: 0, padding: 6 }} aria-label="Sentences">
          {sentences.map((s, i) => (
            <li
              key={s.idx}
              id={`sentence-${i}`}
              className={i === current ? "sent sent-on" : "sent"}
              aria-current={i === current ? "true" : undefined}
              role="button"
              tabIndex={0}
              title="Play from here"
              onClick={() => picked(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onPick(i);
                }
              }}
            >
              <span className="sent-icon" aria-hidden>
                <Icon name="play" size={11} stroke={1.8} />
              </span>
              <span className="mono sent-time">{clock(s.startMs / 1000)}</span>
              <span className="sent-text">{s.text}</span>
            </li>
          ))}
          {busy && <li style={{ padding: "6px 0 4px 82px", fontSize: 12, color: "var(--ink-subtle)" }}>More sentences on the way…</li>}
        </ol>
      )}
    </section>
  );
}

function Details({ episode, item, onRemoved }: { episode: Episode | null; item: Item | null; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const liveTranscript = useTranscript(item?.id ?? null, null);
  const remove = async () => {
    if (!item) return;
    await backend.remove(item.id);
    onRemoved();
  };
  return (
    <aside className="insp" aria-label="Details">
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Details
        </div>
        <div className="prop">
          Source<b>{item?.ownFile ? "Your file" : "Podcast"}</b>
        </div>
        <div className="prop">
          Length<b className="mono">{clock(item?.durationS ?? episode?.durationS)}</b>
        </div>
        {episode && (
          <div className="prop">
            Published<b>{shortDate(episode.publishedAt)}</b>
          </div>
        )}
        <div className="prop">
          {item?.ownFile ? "File" : "Download"}
          <b className="mono">{item?.state === "ready" ? bytes(item.bytes) : episode?.audioBytes ? bytes(episode.audioBytes) : "—"}</b>
        </div>
        <div className="prop">
          Transcript<b>{transcriptLabel(liveTranscript?.state ?? item?.transcriptState)}</b>
        </div>
        {item?.ownFile && item.path && (
          <div className="prop" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            Location
            <b className="mono selectable" style={{ fontSize: 11, wordBreak: "break-all", textAlign: "left" }}>
              {item.path}
            </b>
          </div>
        )}
      </div>
      <div style={{ flexGrow: 1 }} />
      {item &&
        (confirming ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12 }}>
              {item.ownFile ? "Your file stays where it is on this computer." : "The downloaded audio is deleted from this computer."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={remove} autoFocus>
                Remove
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", marginLeft: -12 }} onClick={() => setConfirming(true)}>
            Remove from library
          </button>
        ))}
    </aside>
  );
}
