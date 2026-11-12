// Screens still to come. Each becomes the real screen on the day noted in docs/ROADMAP.md;
// until then they show what a new learner would see with nothing added yet.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { addAudio, Kbd, Page } from "../components/Shell";
import { backend, inApp, on, type Item } from "../lib/backend";
import { dictationPath, percent, progressLabel, useInProgress } from "../lib/dictation";
import { clock, whenDay } from "../lib/format";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Soon({ day }: { day: string }) {
  return <span className="badge badge-next">Arrives {day}</span>;
}

export function Today() {
  const navigate = useNavigate();
  const continuing = useInProgress();
  // The library, recently added or practised first: what to start next.
  const [library, setLibrary] = useState<Item[]>([]);
  useEffect(() => {
    const load = () => backend.library().then((p) => setLibrary(p.items), () => {});
    load();
    const off1 = on("library", load);
    const off2 = on("practice", load);
    return () => {
      off1();
      off2();
    };
  }, []);
  const busy = new Set(continuing.map((c) => c.itemId));
  const recent = library
    .filter((i) => !busy.has(i.id) && i.state !== "failed" && i.state !== "missing")
    .sort((a, b) => Math.max(b.lastPractisedAt ?? 0, b.addedAt) - Math.max(a.lastPractisedAt ?? 0, a.addedAt))
    .slice(0, 6);
  return (
    <Page crumbs={["Today"]} keys={[["Mod O", "Add audio"]]}>
      <div className="page">
        <div>
          <div className="eyebrow">{greeting()}</div>
          <h1 className="h1" style={{ marginTop: 6 }}>
            {continuing.length ? "Continue where you stopped" : "Nothing to continue yet"}
          </h1>
        </div>
        {continuing.length > 0 && (
          <section aria-label="Continue" className="panel" style={{ overflow: "hidden" }}>
            {continuing.map((p) => (
              <div
                key={p.attemptId}
                className="tr"
                style={{ gridTemplateColumns: "minmax(0,1fr) 90px 110px 110px", height: 56 }}
                onClick={() => navigate(`/library/${p.itemId}`)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Art url={p.artworkUrl} size={32} file={p.source === "My files"} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <b className="ell">{p.title}</b>
                    <span className="ell" style={{ fontSize: 12 }}>
                      {p.source}
                    </span>
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {progressLabel(p)}
                </span>
                <span>{whenDay(p.updatedAt)}</span>
                <span style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(dictationPath(p.itemId));
                    }}
                  >
                    Resume
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}
        {recent.length > 0 && (
          <section aria-labelledby="your-library" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <h2 id="your-library" className="eyebrow" style={{ flexGrow: 1 }}>
                From your library
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/library")}>
                All of it
              </button>
            </div>
            <div className="panel" style={{ overflow: "hidden" }}>
              {recent.map((it) => (
                <div
                  key={it.id}
                  className="tr"
                  style={{ gridTemplateColumns: "minmax(0,1fr) 70px 110px 110px", height: 56 }}
                  onClick={() => navigate(`/library/${it.id}`)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <Art url={it.artworkUrl} size={32} file={it.ownFile} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <b className="ell">{it.title}</b>
                      <span className="ell" style={{ fontSize: 12 }}>
                        {it.source}
                      </span>
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {it.durationS ? clock(it.durationS) : ""}
                  </span>
                  <span>{it.practice?.finished ? `Finished · ${percent(it.practice.accuracy)}` : it.lastPractisedAt ? whenDay(it.lastPractisedAt) : "Not started"}</span>
                  <span style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={it.state !== "ready"}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(dictationPath(it.id), it.practice?.finished ? { state: { again: true } } : undefined);
                      }}
                    >
                      {it.practice?.finished ? "Practise again" : "Practise"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="empty" style={continuing.length || recent.length ? { display: "none" } : undefined}>
          <h2 className="h2">Start with an episode</h2>
          <p>
            Find a podcast you like, or add an audio or video file of your own. Eksigo transcribes it on this computer, then
            plays it back one sentence at a time for you to type.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={() => navigate("/podcasts")}>
              <Icon name="podcasts" />
              Find a podcast
            </button>
            <button className="btn" disabled={!inApp} onClick={() => addAudio().then((added) => added && navigate("/library", { state: { added } }))}>
              <Icon name="plus" />
              Add audio
              <Kbd keys="Mod O" />
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}

export function Progress() {
  return (
    <Page crumbs={["Progress"]}>
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="h1" style={{ flexGrow: 1 }}>
            Progress
          </h1>
          <Soon day="after v0.1" />
        </div>
        <div className="empty">
          <h2 className="h2">Your year of practice</h2>
          <p>A grid of the days you practised, your streak and how your accuracy changes over time.</p>
        </div>
      </div>
    </Page>
  );
}
