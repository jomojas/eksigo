// Screens still to come. Each becomes the real screen on the day noted in docs/ROADMAP.md;
// until then they show what a new learner would see with nothing added yet.

import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { addAudio, Kbd, Page } from "../components/Shell";
import { backend, inApp, on, type Item, type PracticeCounts, type Week } from "../lib/backend";
import { dictationPath, percent, progressLabel, useInProgress } from "../lib/dictation";
import { clock, plural, practised, whenDay } from "../lib/format";
import { usePracticeCounts } from "../lib/words";

function Soon({ day }: { day: string }) {
  return <span className="badge badge-next">Arrives {day}</span>;
}

/** The week panel's data, kept fresh as practice happens. */
function useWeek(): Week | null {
  const [week, setWeek] = useState<Week | null>(null);
  useEffect(() => {
    const load = () => backend.week().then(setWeek, () => {});
    load();
    const offs = [on("practice", load), on("words", load)];
    return () => offs.forEach((off) => off());
  }, []);
  return week;
}

/** One line of a list on Today: artwork, title, a line under it and a button. */
function Row({
  art,
  title,
  sub,
  action,
  primary,
  disabled,
  onOpen,
  onAction,
}: {
  art: ReactNode;
  title: string;
  sub: string;
  action: string;
  primary?: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onAction: () => void;
}) {
  return (
    <div className="today-row" onClick={onOpen}>
      {art}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div className="ell" style={{ font: "500 13px/1.3 var(--font-text)", color: "var(--ink)" }}>
          {title}
        </div>
        <div className="ell" style={{ fontSize: 12, color: "var(--ink-subtle)", marginTop: 3 }}>
          {sub}
        </div>
      </div>
      <button
        type="button"
        className={primary ? "btn btn-sm btn-primary" : "btn btn-sm"}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      >
        {action}
      </button>
    </div>
  );
}

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

function WeekPanel({ week, words }: { week: Week | null; words: PracticeCounts | null }) {
  const navigate = useNavigate();
  const days = week?.days ?? [];
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const most = Math.max(1, ...days.map((d) => d.seconds));
  return (
    <aside className="insp" aria-label="This week">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="eyebrow">This week</div>
        <div className="cells" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div className="cell">
            <div className="big">{week ? week.streak : "—"}</div>
            <div className="small">Day streak</div>
          </div>
          <div className="cell">
            <div className="big">{week ? practised(total) : "—"}</div>
            <div className="small">Practised</div>
          </div>
        </div>
        <div className="week-bars" role="img" aria-label={days.map((d) => `${d.day}: ${practised(d.seconds)}`).join(", ")}>
          {days.map((d, i) => (
            <div
              key={d.day}
              title={`${new Date(`${d.day}T12:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${practised(d.seconds)}`}
              data-today={i === days.length - 1 || undefined}
              data-empty={d.seconds === 0 || undefined}
              style={{ height: d.seconds ? `${Math.max(8, (d.seconds / most) * 100)}%` : "8%" }}
            />
          ))}
        </div>
        <div className="week-days mono">
          {days.map((d, i) => (
            <span key={d.day} data-today={i === days.length - 1 || undefined}>
              {DAY_LETTER[new Date(`${d.day}T12:00`).getDay()]}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="eyebrow">My words</div>
        <div className="prop">
          Due for practice<b className="mono">{words ? words.due : "—"}</b>
        </div>
        <div className="prop">
          New to start today<b className="mono">{words ? words.new : "—"}</b>
        </div>
        <div className="prop">
          Started this week<b className="mono">{week ? week.wordsStarted : "—"}</b>
        </div>
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={!words?.total} onClick={() => navigate("/words/practice")}>
          {words?.total ? `Practise ${plural(words.total, "word")}` : "Nothing to practise"}
          {!!words?.total && <Kbd keys="P" />}
        </button>
      </div>
    </aside>
  );
}

export function Today() {
  const navigate = useNavigate();
  const continuing = useInProgress();
  const words = usePracticeCounts();
  const week = useWeek();
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
  const [first, ...others] = continuing;
  const resumeAt = first ? Math.min(first.position + 1, first.sentences || first.position + 1) : 0;

  // Enter resumes, P practises words.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, a")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter" && first) navigate(dictationPath(first.itemId));
      else if (e.key.toLowerCase() === "p" && words?.total) navigate("/words/practice");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, words, navigate]);

  const keys: [string, string][] = [];
  if (first) keys.push(["Enter", "Resume"]);
  if (words?.total) keys.push(["P", "Practise words"]);
  keys.push(["Mod O", "Add audio"]);

  return (
    <Page crumbs={["Today"]} keys={keys}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <div className="page" style={{ flexGrow: 1, minWidth: 0, gap: 28 }}>
          <div>
            <div className="eyebrow">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
            <h1 className="h1" style={{ marginTop: 6 }}>
              {first ? "Pick up where you stopped" : recent.length ? "Start something new" : "Nothing to continue yet"}
            </h1>
          </div>

          {first && (
            <article className="panel continue-card" aria-label="Continue" onClick={() => navigate(`/library/${first.itemId}`)}>
              <Art url={first.artworkUrl} size={64} radius={8} file={first.source === "My files"} />
              <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="eyebrow">Continue</div>
                <div className="h2 ell" style={{ fontSize: 17 }}>
                  {first.title}
                </div>
                <div className="continue-meta">
                  <span className="ell">{first.source}</span>
                  {first.transcriptDone && first.sentences > 0 ? (
                    <>
                      <span className="mono">
                        {first.done} / {first.sentences} sentences
                      </span>
                      <div className="track" style={{ width: 140, flexShrink: 0 }}>
                        <div className="fill" style={{ width: `${Math.round((first.done / first.sentences) * 100)}%` }} />
                      </div>
                    </>
                  ) : (
                    first.done > 0 && <span className="mono">{plural(first.done, "sentence")}</span>
                  )}
                  <span>{whenDay(first.updatedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(dictationPath(first.itemId));
                }}
              >
                Resume at sentence {resumeAt}
                <Kbd keys="Enter" />
              </button>
            </article>
          )}

          {others.length > 0 && (
            <section aria-labelledby="also">
              <h2 id="also" className="eyebrow" style={{ marginBottom: 8 }}>
                Also in progress
              </h2>
              <div className="panel" style={{ overflow: "hidden" }}>
                {others.map((p) => (
                  <Row
                    key={p.attemptId}
                    art={<Art url={p.artworkUrl} size={36} file={p.source === "My files"} />}
                    title={p.title}
                    sub={[p.source, progressLabel(p) && `${progressLabel(p)} sentences`, whenDay(p.updatedAt)].filter(Boolean).join(" · ")}
                    action="Resume"
                    onOpen={() => navigate(`/library/${p.itemId}`)}
                    onAction={() => navigate(dictationPath(p.itemId))}
                  />
                ))}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="your-library">
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <h2 id="your-library" className="eyebrow" style={{ flexGrow: 1 }}>
                  From your library
                </h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/library")}>
                  All of it
                </button>
              </div>
              <div className="panel" style={{ overflow: "hidden" }}>
                {recent.map((it) => (
                  <Row
                    key={it.id}
                    art={<Art url={it.artworkUrl} size={36} file={it.ownFile} />}
                    title={it.title}
                    sub={[
                      it.source,
                      it.durationS ? clock(it.durationS) : "",
                      it.practice?.finished ? `Finished · ${percent(it.practice.accuracy)}` : it.lastPractisedAt ? whenDay(it.lastPractisedAt) : "Not started",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    action={it.practice?.finished ? "Practise again" : "Practise"}
                    disabled={it.state !== "ready"}
                    onOpen={() => navigate(`/library/${it.id}`)}
                    onAction={() => navigate(dictationPath(it.id), it.practice?.finished ? { state: { again: true } } : undefined)}
                  />
                ))}
              </div>
            </section>
          )}

          {!first && !recent.length && (
            <div className="empty">
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
          )}
        </div>
        <WeekPanel week={week} words={words} />
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
