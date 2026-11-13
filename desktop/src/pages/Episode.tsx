// The Episode page, the same from Podcasts and from the Library: download it, preview it, and (from day 4)
// start dictation. A learner's own file has the same page without the podcast parts.

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";
import { backend, on, type Episode, type Item, type Show, type Summary, type TranscriptStatus } from "../lib/backend";
import { reviewPath } from "./Review";
import { listenPath } from "./Listen";
import { dictationPath, percent, progressLabel } from "../lib/dictation";
import { fraction, useDownloads, useLibraryChanged } from "../lib/downloads";
import { bytes, clock, plural, shortDate, whenDay } from "../lib/format";
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
    <Page crumbs={crumbs} keys={ready ? [["L", "Listen"]] : []}>
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

              {item && <Attempts item={item} />}

              {ready && <TranscriptPanel item={item} />}

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
  const navigate = useNavigate();
  const listenable = item?.state === "ready" && !!item.path;
  useEffect(() => {
    if (!listenable || !item) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        navigate(listenPath(item.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listenable, item, navigate]);
  const progress = useDownloads().get(item?.id ?? -1);

  const download = async (open = false) => {
    if (!episode) return;
    try {
      const itemId = await backend.download(episode.id);
      if (open) navigate(dictationPath(itemId));
      else onChange();
    } catch (e) {
      onError(String(e));
    }
  };

  if (!item) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => download(true)} title="Downloads the episode and opens dictation">
          Practise
        </button>
        <button type="button" className="btn" onClick={() => download()}>
          <Icon name="download" size={14} stroke={1.8} />
          Download{episode?.audioBytes ? ` · ${bytes(episode.audioBytes)}` : ""}
        </button>
        <span style={{ fontSize: 12, marginLeft: 4 }}>Downloaded episodes stay in your Library until you remove them.</span>
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
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="btn" onClick={() => navigate(dictationPath(item.id))} title="Dictation opens when the download is done">
          Practise
        </button>
      </div>
    );
  }

  if (item.state === "failed") {
    return (
      <div className="notice notice-error" role="alert">
        <span style={{ flexGrow: 1 }}>{item.error ?? "The download failed."}</span>
        <button type="button" className="btn btn-sm" onClick={() => download()}>
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

  const p = item.practice;
  const open = (again: boolean) => navigate(dictationPath(item.id), again ? { state: { again: true } } : undefined);
  const inProgress = !!p && !p.finished && p.position > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => open(!!p?.finished)}>
          {inProgress ? `Resume dictation at ${p.position + 1}` : p?.finished ? "Dictate again" : "Start dictation"}
        </button>
        <button type="button" className="btn" onClick={() => navigate(listenPath(item.id))}>
          <Icon name="headphones" size={14} />
          Listen <Kbd keys="L" />
        </button>
        {inProgress && (
          <button type="button" className="btn btn-ghost" onClick={() => open(true)}>
            Start dictation over
          </button>
        )}
        {inProgress && <span style={{ fontSize: 12, marginLeft: 4 }}>{progressLabel(p)} sentences dictated so far.</span>}
      </div>
      <div style={{ display: "flex", gap: "4px 24px", flexWrap: "wrap", fontSize: 12 }}>
        <span>
          <b style={{ fontWeight: 500, color: "var(--ink-muted)" }}>Dictate:</b> one sentence at a time, typed from what you hear.
        </span>
        <span>
          <b style={{ fontWeight: 500, color: "var(--ink-muted)" }}>Listen:</b> straight through, sentences hidden until you show them; save words as you go.
        </span>
      </div>
    </div>
  );
}

/** Every attempt at this episode, newest first. The full results view for each arrives on day 5. */
function Attempts({ item }: { item: Item }) {
  const navigate = useNavigate();
  const [list, setList] = useState<Summary[]>([]);
  useEffect(() => {
    const load = () => backend.attempts(item.id).then(setList, () => {});
    load();
    return on("practice", load);
  }, [item.id]);
  const shown = list.filter((s) => s.done > 0 || s.attempt.finishedAt);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="attempts">
      <h2 id="attempts" className="eyebrow" style={{ marginBottom: 8 }}>
        Your attempts
      </h2>
      <div className="panel" style={{ overflow: "hidden" }}>
        {shown.map((s) => (
          <div
            key={s.attempt.id}
            className="tr"
            role="link"
            tabIndex={0}
            title="Open the review"
            onClick={() => navigate(reviewPath(item.id, s.attempt.id))}
            onKeyDown={(e) => e.key === "Enter" && navigate(reviewPath(item.id, s.attempt.id))}
            style={{ gridTemplateColumns: "120px minmax(0,1fr) 90px 80px 110px", borderBottom: "1px solid var(--hairline)", cursor: "pointer" }}
          >
            <span>{whenDay(s.attempt.startedAt)}</span>
            <span>
              {plural(s.done, "sentence")}
              {s.transcriptDone ? ` of ${s.sentences - s.ads}` : ""}
              {s.known > 0 && ` · ${s.known} known`}
              {s.flagged > 0 && ` · ${s.flagged} flagged`}
            </span>
            <b className="mono" style={{ fontSize: 12 }}>
              {percent(s.accuracy)}
            </b>
            <span className="mono" style={{ fontSize: 12 }}>
              {clock(s.attempt.seconds)}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className={s.attempt.finishedAt ? "dot dot-ok" : "dot dot-ring"} />
              {!s.attempt.finishedAt ? "In progress" : s.transcriptDone && s.attempt.position >= s.sentences ? "Finished" : "Stopped"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Back this far into a sentence, "Replay sentence" goes to the one before instead, like a music player. */
/** The transcript's progress on the Episode page: start it, watch it grow, stop it. Reading and listening along
 * happen on the Listen page. */
function TranscriptPanel({ item }: { item: Item }) {
  const [initial, setInitial] = useState<TranscriptStatus | null>(null);
  const live = useTranscript(item.id, initial);
  // Stop looks done the moment it's clicked; the core confirms a moment later.
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (live && !isBusy(live.state)) setStopping(false);
  }, [live]);
  const status = live && stopping && isBusy(live.state) ? { ...live, state: "none" as const, sentences: 0, doneMs: 0 } : live;
  useEffect(() => {
    backend.transcriptStatus(item.id).then(setInitial);
  }, [item.id]);
  return (
    <Transcript
      status={status}
      onStop={() => {
        setStopping(true);
        backend.cancelTranscript(item.id);
      }}
      onStart={() => {
        setStopping(false);
        backend.transcribe(item.id);
      }}
    />
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

/** The transcript: start it and watch it grow. */
function Transcript({ status, onStop, onStart }: { status: TranscriptStatus | null; onStop: () => void; onStart: () => void }) {
  const { model } = useActivity();
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
      </div>

      {status.state === "none" && (
        <div className="panel" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <p style={{ flexGrow: 1, lineHeight: 1.5 }}>
            Eksigo writes out the episode on this computer, sentence by sentence, for listening along and for dictation. It starts on its own
            when you listen or dictate; it takes a few seconds to begin.
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
        <p style={{ fontSize: 12 }}>{status.sentences} sentences · transcribed on this computer with Whisper Fast.</p>
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
