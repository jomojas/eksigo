// A show: its description, Subscribe, and the episodes with what the learner has done with each.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Page } from "../components/Shell";
import { backend, on, type Episode, type Practice, type ShowPage } from "../lib/backend";
import { percent, progressLabel } from "../lib/dictation";
import { fraction, useDownloads, useLibraryChanged } from "../lib/downloads";
import { clock, plural, shortDate } from "../lib/format";

const PAGE = 100;
const COLS = "84px minmax(0,1fr) 64px 170px 104px";
/** A feed read in the last hour isn't read again when the page opens. */
const FRESH_SECONDS = 3600;

export function ShowScreen() {
  const id = Number(useParams().showId);
  const navigate = useNavigate();
  const [page, setPage] = useState<ShowPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState(0);

  const reload = useCallback(() => {
    backend.getShow(id).then(setPage, (e) => setError(String(e)));
  }, [id]);
  useLibraryChanged(reload);
  useEffect(() => on("practice", reload), [reload]);

  useEffect(() => {
    let live = true;
    backend.getShow(id).then(
      (p) => {
        if (!live) return;
        setPage(p);
        const stale = !p.show.refreshedAt || Date.now() / 1000 - p.show.refreshedAt > FRESH_SECONDS || p.episodes.length === 0;
        if (stale) {
          setRefreshing(true);
          backend
            .refreshShow(id)
            .then((fresh) => live && setPage(fresh), (e) => live && setError(String(e)))
            .finally(() => live && setRefreshing(false));
        }
      },
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const episodes = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (page?.episodes ?? []).filter((e) => !f || e.title.toLowerCase().includes(f));
    return oldestFirst ? list.slice().reverse() : list;
  }, [page, filter, oldestFirst]);

  const download = useCallback(
    async (e: Episode) => {
      try {
        await backend.download(e.id);
        reload();
      } catch (err) {
        setError(String(err));
      }
    },
    [reload],
  );

  // ↑ ↓ to move, Enter to open, D to download.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const ep = episodes[selected];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, Math.min(Math.min(episodes.length, shown) - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
        setSelected(next);
        document.getElementById(`ep-${episodes[next]?.id}`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && ep) navigate(`/podcasts/episode/${ep.id}`);
      else if (e.key.toLowerCase() === "d" && ep && !ep.itemId) download(ep);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [episodes, selected, shown, navigate, download]);

  const toggleSubscribe = async () => {
    if (!page) return;
    const on = !page.show.subscribed;
    setPage({ ...page, show: { ...page.show, subscribed: on } });
    await backend.subscribe(id, on);
  };

  const show = page?.show;
  return (
    <Page
      crumbs={[{ label: "Podcasts", to: "/podcasts" }, show?.title ?? "…"]}
      keys={[["↑ ↓", "Move"], ["Enter", "Open"], ["D", "Download"]]}
      status={refreshing ? "Checking for new episodes…" : ""}
    >
      <div className="page">
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        {show && (
          <header style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <Art url={show.artworkUrl} size={132} radius={12} />
            <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 className="h1" style={{ fontSize: 28, letterSpacing: -0.7 }}>
                {show.title}
              </h1>
              {show.author && <div style={{ fontSize: 13 }}>{show.author}</div>}
              {show.description && (
                <p className="clamp-3 selectable" style={{ fontSize: 14, lineHeight: 1.55 }} title={show.description}>
                  {show.description}
                </p>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <button type="button" className={show.subscribed ? "btn" : "btn btn-primary"} onClick={toggleSubscribe}>
                  {show.subscribed && <Icon name="check" size={14} stroke={2} />}
                  {show.subscribed ? "Subscribed" : "Subscribe"}
                </button>
                <span className="badge">{plural(show.episodeCount, "episode")}</span>
              </div>
            </div>
          </header>
        )}

        <section aria-labelledby="eps" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h2 id="eps" className="eyebrow" style={{ flexGrow: 1 }}>
              {page ? (filter ? `${episodes.length} of ${page.episodes.length} episodes` : plural(page.episodes.length, "episode")) : "Episodes"}
            </h2>
            <label className="input" style={{ height: 28, width: 220 }}>
              <Icon name="search" size={13} stroke={1.8} />
              <input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelected(0);
                }}
                placeholder="Filter episodes"
                aria-label="Filter episodes"
              />
            </label>
            <select className="btn btn-sm" value={oldestFirst ? "old" : "new"} onChange={(e) => setOldestFirst(e.target.value === "old")} aria-label="Order">
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </div>
          <div className="th" style={{ gridTemplateColumns: COLS }}>
            <span>Date</span>
            <span>Episode</span>
            <span>Length</span>
            <span>Practice</span>
            <span />
          </div>
          {page && page.episodes.length === 0 && (
            <p className="muted" style={{ padding: "16px 12px" }}>
              {refreshing ? "Reading the feed…" : "This feed has no episodes with audio."}
            </p>
          )}
          {episodes.slice(0, shown).map((e, i) => (
            <EpisodeRow
              key={e.id}
              episode={e}
              on={i === selected}
              onOpen={() => navigate(`/podcasts/episode/${e.id}`)}
              onDownload={() => download(e)}
            />
          ))}
          {episodes.length > shown && (
            <button type="button" className="btn btn-ghost" style={{ alignSelf: "center", marginTop: 12 }} onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, episodes.length - shown)} more
            </button>
          )}
        </section>
      </div>
    </Page>
  );
}

function EpisodeRow({ episode: e, on, onOpen, onDownload }: { episode: Episode; on: boolean; onOpen: () => void; onDownload: () => void }) {
  return (
    <div id={`ep-${e.id}`} className={on ? "tr tr-on" : "tr"} style={{ gridTemplateColumns: COLS }} onClick={onOpen}>
      <span className="mono" style={{ fontSize: 12 }}>
        {shortDate(e.publishedAt)}
      </span>
      <b className="ell" title={e.title}>
        {e.title}
      </b>
      <span className="mono" style={{ fontSize: 12 }}>
        {clock(e.durationS)}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PracticeStatus itemId={e.itemId} state={e.itemState} practice={e.practice} />
      </span>
      <span style={{ textAlign: "right" }}>
        {!e.itemId && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              onDownload();
            }}
          >
            <Icon name="download" size={13} stroke={1.8} />
            Download
          </button>
        )}
      </span>
    </div>
  );
}

/** An episode's state in the Library: downloading, failed, or how far the learner has got with it. */
export function PracticeStatus({ itemId, state, practice }: { itemId: number | null; state: string | null; practice?: Practice | null }) {
  const p = useDownloads().get(itemId ?? -1);
  if (!itemId || !state) return <span style={{ color: "var(--ink-tertiary)" }}>—</span>;
  if (state === "downloading") {
    const f = fraction(p);
    return (
      <>
        <span className="track" style={{ width: 60 }}>
          <span className="fill" style={{ display: "block", width: `${Math.round((f ?? 0) * 100)}%` }} />
        </span>
        <span style={{ fontSize: 12 }}>{f === null ? "Downloading" : `${Math.round(f * 100)}%`}</span>
      </>
    );
  }
  if (state === "failed") return <span style={{ color: "var(--semantic-error)" }}>Download failed</span>;
  if (state === "missing") return <span style={{ color: "var(--semantic-error)" }}>File not found</span>;
  if (practice?.finished && practice.transcriptDone && practice.position >= practice.sentences)
    return (
      <>
        <span className="dot dot-ok" />
        Finished{practice.accuracy !== null && ` · ${percent(practice.accuracy)}`}
      </>
    );
  if (practice && practice.done > 0) {
    const f = practice.transcriptDone && practice.sentences ? practice.done / practice.sentences : null;
    return (
      <>
        {f !== null && (
          <span className="track" style={{ width: 60 }}>
            <span className="fill" style={{ display: "block", width: `${Math.round(f * 100)}%` }} />
          </span>
        )}
        <span className="mono" style={{ fontSize: 12 }}>
          {progressLabel(practice)}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="dot" />
      Not started
    </>
  );
}
