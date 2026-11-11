// The Library: every downloaded episode and every file the learner added, with filters instead of a History page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { addAudio, Kbd, Page } from "../components/Shell";
import { backend, onFileDrop, inApp, type Added, type Item, type LibraryPage } from "../lib/backend";
import { useLibraryChanged } from "../lib/downloads";
import { bytes, clock, plural, whenDay } from "../lib/format";
import { isBusy, transcribed, useTranscript } from "../lib/transcripts";
import { PracticeStatus } from "./Show";

const COLS = "minmax(0,1fr) 160px 64px 190px 72px 110px";

type Kind = "all" | "podcasts" | "files";
type StatusFilter = "any" | "ready" | "downloading" | "problem";
type Sort = "recent" | "added" | "title" | "length";

export function Library() {
  const navigate = useNavigate();
  const location = useLocation();
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [added, setAdded] = useState<Added | null>((location.state as { added?: Added } | null)?.added ?? null);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(() => {
    backend.library().then(setPage);
  }, []);
  useEffect(reload, [reload]);
  useLibraryChanged(reload);

  // Files added with Mod O elsewhere arrive in the navigation state.
  useEffect(() => {
    const a = (location.state as { added?: Added } | null)?.added;
    if (a) setAdded(a);
  }, [location.state]);

  const add = useCallback(async (paths?: string[]) => {
    const result = paths ? await backend.addFiles(paths) : await addAudio();
    if (result) setAdded(result);
  }, []);

  useEffect(() => onFileDrop({ over: setDragging, drop: (paths) => add(paths) }), [add]);

  const items = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (page?.items ?? []).filter(
      (i) =>
        (kind === "all" || (kind === "files") === i.ownFile) &&
        (status === "any" ||
          (status === "ready" && i.state === "ready") ||
          (status === "downloading" && i.state === "downloading") ||
          (status === "problem" && (i.state === "failed" || i.state === "missing"))) &&
        (!f || i.title.toLowerCase().includes(f) || i.source.toLowerCase().includes(f)),
    );
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      recent: () => 0, // the order the database gives
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      length: (a, b) => (b.durationS ?? 0) - (a.durationS ?? 0),
    };
    return list.slice().sort(by[sort]);
  }, [page, kind, status, sort, filter]);

  // ↑ ↓ to move, Enter to open, Delete to remove.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (confirm) {
        if (e.key === "Escape") setConfirm(null);
        return;
      }
      const it = items[selected];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(0, Math.min(items.length - 1, s + (e.key === "ArrowDown" ? 1 : -1))));
      } else if (e.key === "Enter" && it) navigate(`/library/${it.id}`);
      else if ((e.key === "Delete" || e.key === "Backspace") && it) setConfirm(it);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, confirm, navigate]);

  const remove = async (it: Item) => {
    setConfirm(null);
    await backend.remove(it.id);
    reload();
  };

  const all = page?.items ?? [];
  const counts = { all: all.length, podcasts: all.filter((i) => !i.ownFile).length, files: all.filter((i) => i.ownFile).length };
  const statusLine = page ? `${plural(all.length, "item")} · ${bytes(page.downloadsBytes)} downloaded` : "";

  return (
    <Page crumbs={["Library"]} keys={[["Enter", "Open"], ["Mod O", "Add audio"], ["Del", "Remove"]]} status={statusLine}>
      <div className="page" style={{ padding: "20px 32px 32px", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="pills" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["podcasts", "Podcasts"],
                ["files", "My files"],
              ] as [Kind, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" className="pill" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label} <span className="mono">{counts[k]}</span>
              </button>
            ))}
          </div>
          <select className="btn btn-sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
            <option value="any">Any status</option>
            <option value="ready">Ready to practise</option>
            <option value="downloading">Downloading</option>
            <option value="problem">Needs attention</option>
          </select>
          <select className="btn btn-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Order">
            <option value="recent">Last practised</option>
            <option value="added">Recently added</option>
            <option value="title">Title</option>
            <option value="length">Longest first</option>
          </select>
          <span style={{ flexGrow: 1 }} />
          <label className="input" style={{ width: 200 }}>
            <Icon name="search" size={13} stroke={1.8} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter the library" />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => add()} disabled={!inApp} title={inApp ? undefined : "Only in the app"}>
            <Icon name="plus" size={14} stroke={2} />
            Add audio
            <Kbd keys="Mod O" />
          </button>
        </div>

        {added && <AddedNotice added={added} onClose={() => setAdded(null)} />}

        {confirm && (
          <div className="notice" role="alertdialog" aria-label="Remove from library">
            <span style={{ flexGrow: 1 }}>
              Remove <b style={{ color: "var(--ink)", fontWeight: 500 }}>{confirm.title}</b>?{" "}
              {confirm.ownFile ? "Your file stays where it is." : "The downloaded audio is deleted."}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => remove(confirm)} autoFocus>
              Remove
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
              Keep
            </button>
          </div>
        )}

        {page && all.length === 0 ? (
          <div className="empty">
            <h2 className="h2">Nothing here yet</h2>
            <p>Download an episode from Podcasts, or add an audio or video file of your own. Everything you can practise lives here.</p>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-primary" onClick={() => navigate("/podcasts")}>
                <Icon name="podcasts" />
                Find a podcast
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="th" style={{ gridTemplateColumns: COLS }}>
              <span>Title</span>
              <span>From</span>
              <span>Length</span>
              <span>Progress</span>
              <span>Accuracy</span>
              <span>Last practised</span>
            </div>
            {items.map((it, i) => (
              <div
                key={it.id}
                className={i === selected ? "tr tr-on" : "tr"}
                style={{ gridTemplateColumns: COLS }}
                onClick={() => navigate(`/library/${it.id}`)}
                onMouseEnter={() => setSelected(i)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Art url={it.artworkUrl} size={28} file={it.ownFile} />
                  <b className="ell" title={it.title}>
                    {it.title}
                  </b>
                </span>
                <span className="ell">{it.source}</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {clock(it.durationS)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <ItemProgress item={it} />
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  —
                </span>
                <span>{it.lastPractisedAt ? whenDay(it.lastPractisedAt) : "—"}</span>
              </div>
            ))}
            {page && items.length === 0 && (
              <p className="muted" style={{ padding: "16px 12px" }}>
                Nothing matches these filters.
              </p>
            )}
          </div>
        )}

        <div className={dragging ? "dropzone dropzone-on" : "dropzone"} style={{ marginTop: 4 }}>
          <Icon name="upload" size={20} />
          <div>
            <div style={{ font: "500 13px/1.3 var(--font-text)", color: "var(--ink-muted)" }}>
              {dragging ? "Drop to add to your library" : "Drop audio or video files here"}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>MP3, M4A, WAV, MP4 and more. Files stay where they are on this computer.</div>
          </div>
        </div>
      </div>
    </Page>
  );
}

/** Downloading, transcribing, or (from day 4) how far the learner has got. */
function ItemProgress({ item }: { item: Item }) {
  const live = useTranscript(item.id, null);
  const t = live ?? { state: item.transcriptState, doneMs: item.transcriptDoneMs, durationMs: item.durationS ? item.durationS * 1000 : null };
  if (item.state === "ready" && isBusy(t.state)) {
    const f = transcribed(t);
    return (
      <>
        <span className="track" style={{ width: 60 }}>
          <span className="fill" style={{ display: "block", width: `${Math.round(f * 100)}%`, background: "var(--ink-subtle)" }} />
        </span>
        <span style={{ fontSize: 12 }}>{t.state === "running" ? `Transcribing ${Math.round(f * 100)}%` : t.state === "model" ? "Getting the model" : "Waiting"}</span>
      </>
    );
  }
  return <PracticeStatus itemId={item.id} state={item.state} />;
}

function AddedNotice({ added, onClose }: { added: Added; onClose: () => void }) {
  const failed = added.skipped.length > 0;
  return (
    <div className={failed ? "notice notice-error" : "notice"} role="status">
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {added.ids.length > 0 && <span>Added {plural(added.ids.length, "file")} to your library.</span>}
        {added.skipped.map(([path, reason]) => (
          <span key={path}>
            Couldn't add {path.split(/[\\/]/).pop()}: {reason}.
          </span>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Dismiss">
        <Icon name="x" size={13} stroke={1.8} />
      </button>
    </div>
  );
}
