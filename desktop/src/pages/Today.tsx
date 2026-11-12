// Today: what to practise next, and the week so far.

import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { addAudio, Kbd, Page } from "../components/Shell";
import { backend, inApp, on, type NewEpisode, type PracticeCounts, type Week } from "../lib/backend";
import { dictationPath, useInProgress } from "../lib/dictation";
import { clock, plural, practised, whenDay } from "../lib/format";
import { usePracticeCounts } from "../lib/words";

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
const dateOf = (day: string) => new Date(`${day}T12:00`);

function WeekPanel({ week, words }: { week: Week | null; words: PracticeCounts | null }) {
  const navigate = useNavigate();
  const days = week?.days ?? [];
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const most = Math.max(1, ...days.map((d) => d.seconds));
  // The day under the mouse, else today, is spelled out under the bars.
  const [hover, setHover] = useState<number | null>(null);
  const shown = days[hover ?? days.length - 1];
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
        <div className="week-bars" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div key={d.day} className="week-col" data-on={i === hover || undefined} onMouseEnter={() => setHover(i)}>
              <div
                data-today={i === days.length - 1 || undefined}
                data-empty={d.seconds === 0 || undefined}
                style={{ height: d.seconds ? `${Math.max(8, (d.seconds / most) * 100)}%` : "8%" }}
              />
            </div>
          ))}
        </div>
        <div className="week-days mono" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.day} data-today={i === days.length - 1 || undefined} data-on={i === hover || undefined}>
              {DAY_LETTER[dateOf(d.day).getDay()]}
            </span>
          ))}
        </div>
        {shown && (
          <div className="prop" aria-live="polite" style={{ minHeight: 0 }}>
            {hover == null || hover === days.length - 1
              ? "Today"
              : dateOf(shown.day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
            <b className="mono">{practised(shown.seconds)}</b>
          </div>
        )}
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

// Feeds are read again once per run of the app, not each time Today opens.
let feedsRead = false;

/** Today's "New from your shows", from what's saved at once, then again after reading stale feeds. */
function useNewEpisodes(): NewEpisode[] | null {
  const [list, setList] = useState<NewEpisode[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = (refresh: boolean) =>
      backend.newEpisodes(refresh).then(
        (l) => live && setList(l),
        () => live && setList((old) => old ?? []),
      );
    load(false);
    if (!feedsRead) {
      feedsRead = true;
      load(true);
    }
    const offs = [on("library", () => load(false)), on("practice", () => load(false))];
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, []);
  return list;
}

export function Today() {
  const navigate = useNavigate();
  const continuing = useInProgress();
  const words = usePracticeCounts();
  const week = useWeek();
  const fresh = useNewEpisodes();
  const [error, setError] = useState<string | null>(null);
  // Only the episode practised last; the others are in the sidebar's In progress list.
  const first = continuing[0];
  const resumeAt = first ? Math.min(first.position + 1, first.sentences || first.position + 1) : 0;

  const practise = async (e: NewEpisode) => {
    try {
      const itemId = e.itemId ?? (await backend.download(e.id));
      navigate(dictationPath(itemId));
    } catch (err) {
      setError(String(err));
    }
  };

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
              {first ? "Pick up where you stopped" : "Nothing to continue yet"}
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
                  <span className="ell" style={{ minWidth: 60 }}>{first.source}</span>
                  {first.transcriptDone && first.sentences > 0 ? (
                    <>
                      <span className="mono">
                        {first.done} / {first.sentences} sentences
                      </span>
                      <div className="track" style={{ flex: "0 1 140px", minWidth: 40 }}>
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

          <section aria-labelledby="heard">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h2 id="heard" className="eyebrow" style={{ flexGrow: 1 }}>
                Heard on your phone today
              </h2>
              <span className="badge badge-next">With the phone app · later</span>
            </div>
            <div className="panel today-note">Episodes you listen to on your phone will show up here, ready to practise.</div>
          </section>

          <section aria-labelledby="new">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h2 id="new" className="eyebrow" style={{ flexGrow: 1 }}>
                New from your shows
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/podcasts")}>
                Podcasts
              </button>
            </div>
            {error && (
              <div className="muted" role="alert" style={{ fontSize: 12, marginBottom: 8 }}>
                {error}
              </div>
            )}
            {fresh && fresh.length > 0 && (
              <div className="panel" style={{ overflow: "hidden" }}>
                {fresh.map((e) => (
                  <Row
                    key={e.id}
                    art={<Art url={e.artworkUrl} size={36} />}
                    title={e.title}
                    sub={[e.showTitle, e.durationS ? clock(e.durationS) : "", e.publishedAt ? whenDay(e.publishedAt) : ""].filter(Boolean).join(" · ")}
                    action="Practise"
                    onOpen={() => navigate(`/podcasts/episode/${e.id}`)}
                    onAction={() => practise(e)}
                  />
                ))}
              </div>
            )}
            {fresh && fresh.length === 0 && (
              <div className="panel today-note" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 240px" }}>Subscribe to shows you like, and their newest episodes appear here each day.</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate("/podcasts")}>
                  <Icon name="podcasts" />
                  Find a podcast
                </button>
                <button type="button" className="btn btn-sm" disabled={!inApp} onClick={() => addAudio().then((added) => added && navigate("/library", { state: { added } }))}>
                  <Icon name="plus" />
                  Add audio
                </button>
              </div>
            )}
          </section>
        </div>
        <WeekPanel week={week} words={words} />
      </div>
    </Page>
  );
}
