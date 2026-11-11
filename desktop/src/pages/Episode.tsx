// The Episode page, the same from Podcasts and from the Library: download it, preview it, and (from day 4)
// start dictation. A learner's own file has the same page without the podcast parts.

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";
import { backend, type Episode, type Item, type Show } from "../lib/backend";
import { fraction, useDownloads, useLibraryChanged } from "../lib/downloads";
import { bytes, clock, shortDate, whenDay } from "../lib/format";
import { SPEEDS, usePlayer } from "../lib/playback";

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
        <div className="page page-read" style={{ flexGrow: 1, minWidth: 0, gap: 26 }}>
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
                  <h1 className="h1 selectable" style={{ fontSize: 26, letterSpacing: -0.6 }}>
                    {title}
                  </h1>
                  <div style={{ fontSize: 12 }} className="mono">
                    {clock(item?.durationS ?? episode?.durationS)}
                  </div>
                </div>
              </header>

              <Actions episode={episode} item={item} onChange={load} onError={setError} />

              {ready && <Preview path={item.path!} durationS={item.durationS ?? episode?.durationS ?? null} />}

              {episode?.description && (
                <section aria-labelledby="about">
                  <h2 id="about" className="eyebrow" style={{ marginBottom: 8 }}>
                    About this episode
                  </h2>
                  <p className="selectable" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 640 }}>
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

function Details({ episode, item, onRemoved }: { episode: Episode | null; item: Item | null; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
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
          Transcript<b>Arrives day 3</b>
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
