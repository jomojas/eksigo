// The Episode page, the same from Podcasts and from the Library: download it, preview it, and (from day 4)
// start dictation. A learner's own file has the same page without the podcast parts.

import { useCallback, useEffect, useState } from "react";
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
    <Page crumbs={crumbs} keys={ready ? [["Space", "Preview"], ["← →", "5 seconds"]] : []}>
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

              {ready && <Preview path={item.path!} durationS={item.durationS ?? episode?.durationS ?? null} />}

              {ready && <Transcript item={item} />}

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

/** Listen before practising: play, jump, and change the speed without changing the pitch. */
function Preview({ path, durationS }: { path: string; durationS: number | null }) {
  const player = usePlayer(path);
  const [speed, setSpeed] = useState(1);
  const [at, setAt] = useState(0);
  const durMs = (durationS ?? 0) * 1000;
  const pos = player.playing ? player.positionMs : at;

  // While playing, remember where we are, so pausing and playing again carries on.
  useEffect(() => {
    if (player.playing) setAt(player.positionMs);
  }, [player.playing, player.positionMs]);

  const playFrom = useCallback(
    (ms: number, s = speed) => {
      const start = Math.max(0, Math.min(ms, durMs ? durMs - 500 : ms));
      setAt(start);
      player.play(start, null, s);
    },
    [player, speed, durMs],
  );

  const toggle = useCallback(() => (player.playing ? player.stop() : playFrom(at >= durMs - 500 && durMs ? 0 : at)), [player, playFrom, at, durMs]);
  const jump = useCallback(
    (delta: number) => {
      const target = Math.max(0, pos + delta);
      if (player.playing) playFrom(target);
      else setAt(target);
    },
    [player.playing, playFrom, pos],
  );
  /** The five seconds before here, exactly, then stop: what replaying a sentence will do. */
  const replay = () => {
    const end = Math.max(5000, pos);
    setAt(end);
    player.play(end - 5000, end, speed);
  };

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, jump]);

  return (
    <section aria-labelledby="preview" className="panel" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 id="preview" className="eyebrow" style={{ flexGrow: 1 }}>
          Preview
        </h2>
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
        <button type="button" className="btn btn-sm" onClick={replay} title="Play the 5 seconds before this point, then stop">
          <Icon name="replay" size={13} stroke={1.8} />
          Last 5 s
        </button>
      </div>
      {player.error && <p style={{ color: "var(--semantic-error)" }}>{player.error}</p>}
      <p style={{ fontSize: 12 }}>
        <Kbd keys="Space" /> play or pause · <Kbd keys="←" /> <Kbd keys="→" /> 5 seconds. Slower speeds keep the voice at its normal pitch.
      </p>
    </section>
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

/** The transcript: start it, watch it grow, and listen to any sentence exactly as dictation will play it. */
function Transcript({ item }: { item: Item }) {
  const [initial, setInitial] = useState<TranscriptStatus | null>(null);
  const status = useTranscript(item.id, initial);
  const { model } = useActivity();
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState<number | null>(null);
  const player = usePlayer(item.path);

  useEffect(() => {
    backend.transcriptStatus(item.id).then(setInitial);
  }, [item.id]);

  // New sentences arrive a chunk at a time.
  const count = status?.sentences ?? 0;
  useEffect(() => {
    if (count > 0) backend.sentences(item.id).then(setSentences);
    else setSentences([]);
  }, [item.id, count]);

  useEffect(() => {
    if (!player.playing) setPlaying(null);
  }, [player.playing]);

  if (!status) return null;
  const f = transcribed(status);
  const busy = isBusy(status.state);
  const minutes = (ms: number | null) => (ms ? Math.max(1, Math.round(ms / 60_000)) : 0);

  return (
    <section aria-labelledby="transcript" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 28 }}>
        <h2 id="transcript" className="eyebrow" style={{ flexGrow: 1 }}>
          Transcript
        </h2>
        {sentences.length > 0 && (
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map((v) => (
              <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                {v === 1 ? "1.0" : v}×
              </button>
            ))}
          </div>
        )}
      </div>

      {status.state === "none" && (
        <div className="panel" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <p style={{ flexGrow: 1, lineHeight: 1.5 }}>
            Eksigo writes out the episode on this computer, sentence by sentence, so dictation can play one sentence at a time. It takes a
            few seconds to start; you can listen to the sentences as they arrive.
          </p>
          <button type="button" className="btn" onClick={() => backend.transcribe(item.id)}>
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => backend.cancelTranscript(item.id)}>
            Stop
          </button>
        </div>
      )}

      {status.state === "failed" && (
        <div className="notice notice-error" role="alert">
          <span style={{ flexGrow: 1 }}>{status.error ?? "Transcription failed."}</span>
          <button type="button" className="btn btn-sm" onClick={() => backend.transcribe(item.id)}>
            Try again
          </button>
        </div>
      )}

      {status.state === "done" && <p style={{ fontSize: 12 }}>{status.sentences} sentences · transcribed on this computer with Whisper Fast.</p>}

      {sentences.length > 0 && (
        <ol className="panel selectable" style={{ listStyle: "none", margin: 0, padding: "6px 6px 6px 2px" }} aria-label="Sentences">
          {sentences.map((s) => (
            <li key={s.idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0" }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: 28, padding: 0, flexShrink: 0 }}
                aria-label={playing === s.idx ? "Stop" : `Play sentence ${s.idx + 1}`}
                onClick={() => {
                  if (playing === s.idx) player.stop();
                  else {
                    setPlaying(s.idx);
                    player.play(s.startMs, s.endMs, speed);
                  }
                }}
              >
                <Icon name={playing === s.idx ? "pause" : "play"} size={11} stroke={playing === s.idx ? 2.4 : 1.6} />
              </button>
              <span className="mono" style={{ fontSize: 11, width: 40, flexShrink: 0, paddingTop: 7, color: "var(--ink-subtle)" }}>
                {clock(s.startMs / 1000)}
              </span>
              <span style={{ paddingTop: 4, lineHeight: 1.5, color: playing === s.idx ? "var(--ink)" : "var(--ink-muted)" }}>{s.text}</span>
            </li>
          ))}
          {busy && (
            <li style={{ padding: "6px 0 4px 76px", fontSize: 12, color: "var(--ink-subtle)" }}>More sentences on the way…</li>
          )}
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
