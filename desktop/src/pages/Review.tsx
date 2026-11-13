// The review of one attempt: the original and what was typed, side by side, with mistakes marked and the
// sentences flagged during dictation. With AI set up (designs D17, D18): why a sentence was misheard, and a
// review of the whole episode once it's finished. Shown when stopping or finishing, and from the Episode page
// (`/library/:itemId/review/:attemptId`). Selecting words in the original opens the dictionary card.

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { problemText, SETTINGS_AI, useAi } from "../lib/ai";
import { useMeaningLanguage } from "../lib/words";
import { Icon } from "../components/Icon";
import { LookupCard, type Selection } from "../components/LookupCard";
import { IndexedText, MarkedText, selectedWords } from "../components/Marks";
import { Page } from "../components/Shell";
import { aiProblem, backend, on, type AiProblem, type AiStatus, type Answer, type EpisodeReview, type Item, type Sentence, type Session, type Summary, type Why } from "../lib/backend";
import { dictationPath, percent, useDictationSettings } from "../lib/dictation";
import { clock, plural } from "../lib/format";
import { usePlayer } from "../lib/playback";

type Filter = "all" | "flagged" | "mistakes";

export function Review({
  item,
  summary: s,
  answers,
  flagged,
  sentences,
  maxPlays,
  onFlag,
  onResume,
  onAgain,
  onBack,
}: {
  item: { id: number; path: string | null };
  summary: Summary;
  answers: Map<number, Answer>;
  flagged: Set<number>;
  sentences: Sentence[];
  maxPlays: number;
  onFlag: (idx: number, on: boolean) => void;
  onResume: (() => void) | null;
  onAgain: (() => void) | null;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(flagged.size > 0 ? "flagged" : "all");
  // Every answered sentence, and flagged ones not answered yet.
  const rows = useMemo(() => {
    const idx = new Set([...answers.values()].filter((a) => a.kind !== "ad").map((a) => a.idx));
    flagged.forEach((i) => idx.add(i));
    return [...idx].sort((a, b) => a - b);
  }, [answers, flagged]);
  const mistaken = (i: number) => {
    const a = answers.get(i);
    return !!a && a.kind === "typed" && a.credit < a.total;
  };
  const shown = rows.filter((i) => filter === "all" || (filter === "flagged" ? flagged.has(i) : mistaken(i)));
  const counts = { all: rows.length, flagged: rows.filter((i) => flagged.has(i)).length, mistakes: rows.filter(mistaken).length };
  const finished = s.attempt.finishedAt !== null;
  const player = usePlayer(item.path);
  const [playing, setPlaying] = useState<number | null>(null);
  const playRow = (i: number) => {
    const sen = sentences[i];
    if (!sen) return;
    setPlaying(i);
    player.play(sen.startMs, sen.endMs, 1);
  };
  const [lookup, setLookup] = useState<Selection | null>(null);
  const { status: ai } = useAi();
  const [lang] = useMeaningLanguage();
  const navigate = useNavigate();
  // Why each opened sentence was misheard: asked when first opened, then kept (also on the computer, per attempt).
  const [whys, setWhys] = useState<Map<number, WhyState>>(new Map());
  const toggleWhy = (i: number, again = false) => {
    if (whys.has(i) && !again) {
      setWhys((m) => {
        const n = new Map(m);
        n.delete(i);
        return n;
      });
      return;
    }
    const put = (st: WhyState) => setWhys((m) => new Map(m).set(i, st));
    if (!ai?.using) return put({ state: "problem", problem: { kind: "notSetUp" } });
    put({ state: "loading" });
    backend.aiWhy(lang, s.attempt.id, i).then(
      (why) => put({ state: "done", why }),
      (e) => put({ state: "problem", problem: aiProblem(e) }),
    );
  };
  // From the episode review: show a sentence among those with mistakes.
  const showSentence = (n: number) => {
    setFilter("mistakes");
    window.requestAnimationFrame(() => document.getElementById(`review-row-${n - 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  // Selecting words (a double-click, or a drag) looks them up, as on the Listen page.
  const onSelect = (i: number, e: MouseEvent<HTMLElement>) => {
    const root = e.currentTarget;
    window.setTimeout(() => {
      const range = selectedWords(root);
      const r = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (!range || !r) return;
      const text = answers.get(i)?.original ?? sentences[i]?.text ?? "";
      const words = text.split(/\s+/).filter(Boolean);
      setLookup({ itemId: item.id, idx: i, from: range[0], to: range[1], text: words.slice(range[0], range[1] + 1).join(" "), typed: answers.get(i)?.typed ?? "", sentence: text, rect: r.getBoundingClientRect() });
    }, 0);
  };

  return (
    <div className="page" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="h1" style={{ flexGrow: 1 }}>
          {finished ? "Review" : "Review so far"}
        </h1>
        {onResume && (
          <button type="button" className="btn btn-primary" onClick={onResume} autoFocus>
            Resume at sentence {s.attempt.position + 1}
          </button>
        )}
        {onAgain && (
          <button type="button" className={onResume ? "btn" : "btn btn-primary"} onClick={onAgain} autoFocus={!onResume}>
            Practise again
          </button>
        )}
        <button type="button" className="btn" onClick={onBack}>
          Back to the episode
        </button>
      </div>
      {finished && counts.mistakes > 0 && <EpisodeReviewPanel attemptId={s.attempt.id} mistakes={counts.mistakes} ai={ai} lang={lang} onShow={showSentence} />}
      <div className="cells" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        <Cell big={percent(s.accuracy)} small="Accuracy" />
        <Cell big={`${s.done}${s.transcriptDone ? ` / ${s.sentences - s.ads}` : ""}`} small="Sentences done" />
        <Cell big={String(s.known)} small="Known" />
        <Cell big={String(flagged.size)} small="Flagged" />
        <Cell big={clock(s.attempt.seconds)} small="Time" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span className="seg" role="group" aria-label="Show">
          {(
            [
              ["all", "All"],
              ["flagged", "Flagged"],
              ["mistakes", "With mistakes"],
            ] as const
          ).map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ gap: 6 }}>
              {f === "flagged" && <Icon name="flag" size={12} />}
              {label}
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-subtle)" }}>
                {counts[f]}
              </span>
            </button>
          ))}
        </span>
        <span style={{ fontSize: 12 }}>
          Select words in the original to look them up. <span className="w w-missing">Boxed</span> words were missed, <span className="w w-wrong">red</span> ones wrong,{" "}
          <span className="w w-spelling">underlined</span> ones misspelled (half a word).
          {s.ads > 0 && ` ${plural(s.ads, "sentence")} skipped as ads.`}
        </span>
      </div>
      <div className="panel selectable" style={{ overflow: "hidden" }}>
        <div className="review-row review-head">
          <span />
          <span>Original</span>
          <span>You typed</span>
          <span />
        </div>
        {shown.map((i) => {
          const a = answers.get(i);
          const isFlagged = flagged.has(i);
          return (
            <div key={i} id={`review-row-${i}`} className={`review-row${isFlagged ? " review-flagged" : ""}`}>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="btn flag-btn"
                  style={{ borderRadius: 9999, color: "var(--ink-muted)" }}
                  aria-label={`Play sentence ${i + 1}`}
                  onClick={() => (player.playing && playing === i ? player.stop() : playRow(i))}
                  disabled={!item.path || !sentences[i]}
                >
                  <Icon name={player.playing && playing === i ? "pause" : "play"} size={11} />
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost flag-btn${isFlagged ? " on" : ""}`}
                  aria-pressed={isFlagged}
                  aria-label={isFlagged ? `Unflag sentence ${i + 1}` : `Flag sentence ${i + 1}`}
                  title={isFlagged ? "Flagged for review" : "Flag for review"}
                  onClick={() => onFlag(i, !isFlagged)}
                >
                  <Icon name="flag" size={13} />
                </button>
              </span>
              <span style={{ color: "var(--ink)", cursor: "text" }} onMouseUp={(e) => onSelect(i, e)}>
                {a?.comparison ? <MarkedText words={a.comparison.original} indexed /> : <IndexedText text={a?.original ?? sentences[i]?.text ?? ""} />}
              </span>
              <span>
                {!a ? (
                  <span style={{ color: "var(--ink-tertiary)" }}>Not done yet</span>
                ) : a.kind === "known" ? (
                  <span style={{ color: "var(--ink-tertiary)" }}>Known · not typed</span>
                ) : a.comparison?.typed.length ? (
                  <MarkedText words={a.comparison.typed} />
                ) : (
                  <span style={{ color: "var(--ink-tertiary)" }}>(nothing typed)</span>
                )}
                {mistaken(i) && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    <button type="button" className={whys.has(i) ? "btn btn-xs" : "btn btn-xs btn-ghost"} style={whys.has(i) ? undefined : { paddingLeft: 0 }} aria-expanded={whys.has(i)} onClick={() => toggleWhy(i)}>
                      Why did I miss this?
                      {whys.has(i) && <Icon name="chevron-up" size={11} />}
                    </button>
                  </span>
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, fontSize: 11, whiteSpace: "nowrap" }}>
                {a && a.kind === "typed" && (
                  <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }}>
                    {percent(a.total ? a.credit / a.total : 1)}
                  </span>
                )}
                {a && (
                  <span>
                    {plural(a.plays, "play")}
                    {a.plays > maxPlays && ` · ${a.plays - maxPlays} over`}
                  </span>
                )}
              </span>
              {whys.has(i) && (
                <WhyBox
                  idx={i}
                  st={whys.get(i)!}
                  ai={ai}
                  onAgain={() => toggleWhy(i, true)}
                  onSetUp={() => navigate(SETTINGS_AI)}
                  onPlaySlowly={() => {
                    const sen = sentences[i];
                    if (sen && item.path) {
                      setPlaying(i);
                      player.play(sen.startMs, sen.endMs, 0.7);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
        {lookup && (
          <LookupCard
            sel={lookup}
            path={item.path}
            onClose={() => {
              setLookup(null);
              window.getSelection()?.removeAllRanges();
            }}
          />
        )}
        {shown.length === 0 && (
          <div style={{ padding: 16 }}>
            {filter === "flagged" ? "No flagged sentences. Press Mod D while dictating to flag one." : filter === "mistakes" ? "No mistakes." : "No sentences done yet."}
          </div>
        )}
      </div>
    </div>
  );
}

type WhyState = { state: "loading" } | { state: "done"; why: Why } | { state: "problem"; problem: AiProblem };

const sourceName = (ai: AiStatus | undefined) => (ai?.using === "chatgpt" ? "ChatGPT plan" : (ai?.key?.name ?? ""));

/** Why a sentence was misheard (design D17), under its row. */
function WhyBox({ idx, st, ai, onAgain, onSetUp, onPlaySlowly }: { idx: number; st: WhyState; ai: AiStatus | undefined; onAgain: () => void; onSetUp: () => void; onPlaySlowly: () => void }) {
  if (st.state === "problem" && (st.problem.kind === "notSetUp" || st.problem.kind === "reconnect"))
    return (
      <div className="why-box" role="region" aria-label="AI not set up" style={{ gridColumn: "2 / 4", flexDirection: "row", alignItems: "center", gap: 14 }}>
        <div style={{ flexGrow: 1 }}>
          <div className="account-row-t">{st.problem.kind === "reconnect" ? "ChatGPT needs connecting again" : "AI can explain why you misheard this"}</div>
          <div className="account-row-h">Connect ChatGPT Plus or your own API key once, in Settings › AI.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onSetUp}>
          Set up AI
        </button>
      </div>
    );
  return (
    <div className="why-box" role="region" aria-label={`Why you misheard sentence ${idx + 1}`} aria-live="polite" style={{ gridColumn: "2 / 4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="h2" style={{ fontSize: 14 }}>
          Why you misheard this
        </span>
        <span style={{ flexGrow: 1 }} />
        {st.state === "done" && (
          <span className="ai-source">
            <span className="dot dot-ok" aria-hidden="true" />
            {sourceName(ai)}
          </span>
        )}
      </div>
      {st.state === "loading" && <div className="lookup-sub">Listening to it again…</div>}
      {st.state === "problem" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="lookup-sub" style={{ flexGrow: 1 }}>
            {problemText(st.problem)}
          </span>
          {st.problem.kind === "limit" ? (
            <button type="button" className="btn btn-sm" onClick={() => backend.manageUsage()}>
              Manage usage
              <Icon name="external" size={12} />
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onAgain}>
              Try again
            </button>
          )}
        </div>
      )}
      {st.state === "done" &&
        st.why.items.map((w, k) => (
          <div key={k} className="why-item">
            <div>
              <span className="w w-missing">{w.original}</span>
              {w.typed && w.typed !== "_" && (
                <>
                  {" "}
                  <span className="muted">→</span> <span className="w w-wrong">{w.typed}</span>
                </>
              )}
              {w.said && <div className="why-said">said {w.said}</div>}
            </div>
            <div>{w.why}</div>
          </div>
        ))}
      {st.state === "done" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
          <button type="button" className="btn btn-sm" onClick={onPlaySlowly}>
            <Icon name="play" size={11} />
            Play at 0.7×
          </button>
        </div>
      )}
    </div>
  );
}

/** The review of a finished episode (design D18): written by itself when the review opens, then kept. */
function EpisodeReviewPanel({ attemptId, mistakes, ai, lang, onShow }: { attemptId: number; mistakes: number; ai: AiStatus | undefined; lang: string; onShow: (n: number) => void }) {
  const navigate = useNavigate();
  const [st, setSt] = useState<{ state: "loading" } | { state: "done"; review: EpisodeReview } | { state: "problem"; problem: AiProblem } | null>(null);
  const [again, setAgain] = useState(0);
  const using = !!ai?.using;
  useEffect(() => {
    if (!using) return setSt(null);
    let live = true;
    setSt({ state: "loading" });
    backend.aiReview(lang, attemptId).then(
      (review) => live && setSt(review ? { state: "done", review } : null),
      (e) => live && setSt({ state: "problem", problem: aiProblem(e) }),
    );
    return () => {
      live = false;
    };
  }, [using, lang, attemptId, again]);

  if (ai === undefined) return null;
  if (!using)
    return (
      <div className="panel" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
        <span className="muted" style={{ flexGrow: 1 }}>
          With AI set up, a review of your {plural(mistakes, "sentence")} with mistakes appears here: what they have in common and what to practise.
        </span>
        <button type="button" className="btn btn-sm" onClick={() => navigate(SETTINGS_AI)}>
          Set up AI
        </button>
      </div>
    );
  if (!st) return null;
  return (
    <section className="panel ai-review" aria-labelledby="episode-review">
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 id="episode-review" className="h2">
            Episode review
          </h2>
          {st.state === "done" && (
            <span className="ai-source">
              <span className="dot dot-ok" aria-hidden="true" />
              {sourceName(ai)} · written when you finished
            </span>
          )}
        </div>
        {st.state === "loading" && (
          <div role="status" style={{ padding: "16px 0 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink-muted)" }}>
              <span className="spin" aria-hidden="true" />
              Reading your {plural(mistakes, "sentence")} with mistakes…
            </div>
            <div className="skel" style={{ width: "92%" }} />
            <div className="skel" style={{ width: "78%" }} />
            <div className="skel" style={{ width: "60%" }} />
          </div>
        )}
        {st.state === "problem" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 16px", flexWrap: "wrap" }}>
            <span className="muted" style={{ flexGrow: 1, fontSize: 13 }}>
              {problemText(st.problem)}
            </span>
            {st.problem.kind === "limit" ? (
              <button type="button" className="btn btn-sm" onClick={() => backend.manageUsage()}>
                Manage usage
                <Icon name="external" size={12} />
              </button>
            ) : st.problem.kind === "failed" ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAgain((n) => n + 1)}>
                Try again
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => navigate(SETTINGS_AI)}>
                Settings › AI
              </button>
            )}
          </div>
        )}
        {st.state === "done" && (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink)", margin: "8px 0 10px" }}>{st.review.summary}</p>
            {st.review.patterns.map((p, k) => (
              <div key={k} className="ai-pattern">
                <span className="ai-pattern-n">{p.count}</span>
                <div>
                  <div style={{ font: "500 14px/1.4 var(--font-text)", color: "var(--ink)" }}>{p.title}</div>
                  <div className="ai-text" style={{ marginTop: 2 }}>
                    {p.explanation}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 180 }}>
                  {p.sentences.slice(0, 4).map((n) => (
                    <button key={n} type="button" className="ai-chip" onClick={() => onShow(n)} aria-label={`Show sentence ${n}`}>
                      {n}
                    </button>
                  ))}
                  {p.sentences.length > 4 && <span className="ai-chip" style={{ cursor: "default" }}>+{p.sentences.length - 4}</span>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {st.state === "done" && st.review.next && (
        <div className="ai-next">
          <span className="eyebrow">Next time</span>
          <p className="ai-text">{st.review.next}</p>
        </div>
      )}
    </section>
  );
}

function Cell({ big, small }: { big: string; small: string }) {
  return (
    <div className="cell">
      <div className="big">{big}</div>
      <div className="small">{small}</div>
    </div>
  );
}

/** The review of a past attempt, opened from the Episode page. */
export function ReviewScreen() {
  const params = useParams();
  const itemId = Number(params.itemId);
  const attemptId = Number(params.attemptId);
  const navigate = useNavigate();
  const [settings] = useDictationSettings();
  const [item, setItem] = useState<Item | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([backend.session(attemptId), backend.summary(attemptId)]).then(
      ([se, su]) => {
        setSession(se);
        setSummary(su);
      },
      (e) => setError(String(e)),
    );
  }, [attemptId]);
  useEffect(() => {
    backend.item(itemId).then(setItem, (e) => setError(String(e)));
    backend.sentences(itemId).then(setSentences);
    load();
    return on("practice", load);
  }, [itemId, load]);

  const answers = useMemo(() => new Map(session?.answers.map((a) => [a.idx, a]) ?? []), [session]);
  const flagged = useMemo(() => new Set(session?.flagged ?? []), [session]);
  const crumbs = [
    { label: "Library", to: "/library" },
    { label: item?.title ?? "…", to: `/library/${itemId}` },
  ];
  return (
    <Page crumbs={crumbs}>
      {error ? (
        <div className="page">
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        </div>
      ) : session && summary ? (
        <Review
          item={{ id: itemId, path: item?.path ?? null }}
          summary={summary}
          answers={answers}
          flagged={flagged}
          sentences={sentences}
          maxPlays={settings.maxPlays}
          onFlag={(i, v) => backend.flag(attemptId, i, v).catch((e) => setError(String(e)))}
          onResume={summary.attempt.finishedAt === null ? () => navigate(dictationPath(itemId)) : null}
          onAgain={() => navigate(dictationPath(itemId), { state: { again: true } })}
          onBack={() => navigate(`/library/${itemId}`)}
        />
      ) : (
        <div className="page">Opening…</div>
      )}
    </Page>
  );
}

export const reviewPath = (itemId: number, attemptId: number) => `/library/${itemId}/review/${attemptId}`;
