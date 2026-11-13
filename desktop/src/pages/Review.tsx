// The review of one attempt: the original and what was typed, side by side, with mistakes marked and the
// sentences flagged during dictation. With AI set up (designs D17, D18): questions about a sentence (why it was
// misheard, by reason, or the learner's own; ? opens it), and a review of the whole episode by reason once it's
// finished. Shown when stopping or finishing, and from the Episode page
// (`/library/:itemId/review/:attemptId`). Selecting words in the original opens the dictionary card.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { saveWordFrom, SETTINGS_AI, useAi } from "../lib/ai";
import { AiProblemLine, AiSource, AskPanel, ReasonTag } from "../components/Ask";
import { useMeaningLanguage } from "../lib/words";
import { Icon } from "../components/Icon";
import { LookupCard, type Selection } from "../components/LookupCard";
import { IndexedText, MarkedText, selectedWords } from "../components/Marks";
import { Kbd, Page } from "../components/Shell";
import { aiProblem, backend, on, type AiProblem, type AiStatus, type Answer, type EpisodeReview, type Item, type ReviewPattern, type Sentence, type Session, type Summary } from "../lib/backend";
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
  // The sentences whose questions are open, the ones asked about before, and the one ? opens: the last row
  // touched, or the first with mistakes.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const [touched, setTouched] = useState<number | null>(null);
  useEffect(() => {
    backend.aiAsked(item.id, s.attempt.id).then((a) => setAsked(new Set(a)), () => {});
  }, [item.id, s.attempt.id]);
  const toggleAsk = (i: number) => {
    setTouched(i);
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!(e.key === "?" || (e.shiftKey && e.code === "Slash")) || e.metaKey || e.ctrlKey || e.altKey || lookup) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
    const i = touched !== null && shown.includes(touched) ? touched : (shown.find(mistaken) ?? shown[0]);
    if (i === undefined) return;
    e.preventDefault();
    toggleAsk(i);
    window.requestAnimationFrame(() => document.getElementById(`review-row-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const playSlowly = (i: number) => {
    const sen = sentences[i];
    if (sen && item.path) {
      setPlaying(i);
      player.play(sen.startMs, sen.endMs, 0.7);
    }
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
      setTouched(i);
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
      {finished && counts.mistakes > 0 && <EpisodeReviewPanel itemId={item.id} attemptId={s.attempt.id} answers={answers} mistakes={counts.mistakes} ai={ai} lang={lang} onShow={showSentence} />}
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
          Select words in the original to look them up{ai?.using ? <> · <Kbd keys="?" /> asks about a sentence</> : ""}. <span className="w w-missing">Boxed</span> words were missed, <span className="w w-wrong">red</span> ones wrong,{" "}
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
                  onClick={() => (setTouched(i), player.playing && playing === i ? player.stop() : playRow(i))}
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
                {a && (mistaken(i) || asked.has(i) || open.has(i)) && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    <button type="button" className={open.has(i) ? "btn btn-xs" : "btn btn-xs btn-ghost"} style={open.has(i) ? undefined : { paddingLeft: 0 }} aria-expanded={open.has(i)} onClick={() => toggleAsk(i)}>
                      <Icon name="chat" size={12} />
                      {asked.has(i) && !open.has(i) ? "Your questions about this sentence" : "Ask about this sentence"}
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
              {open.has(i) && (
                <AskPanel
                  itemId={item.id}
                  attemptId={s.attempt.id}
                  idx={i}
                  sentence={a?.original ?? sentences[i]?.text ?? ""}
                  typed={a?.typed ?? ""}
                  mistakes={mistaken(i)}
                  onPlaySlowly={item.path && sentences[i] ? () => playSlowly(i) : null}
                  onClose={() => {
                    toggleAsk(i);
                    backend.aiAsked(item.id, s.attempt.id).then((x) => setAsked(new Set(x)), () => {});
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

/** The review of a finished episode (design D18): its mistakes by reason, written by itself when the review
 * opens, then kept. */
function EpisodeReviewPanel({
  itemId,
  attemptId,
  answers,
  mistakes,
  ai,
  lang,
  onShow,
}: {
  itemId: number;
  attemptId: number;
  answers: Map<number, Answer>;
  mistakes: number;
  ai: AiStatus | undefined;
  lang: string;
  onShow: (n: number) => void;
}) {
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
          With AI set up, a review of your {plural(mistakes, "sentence")} with mistakes appears here: why you missed them, by reason, and what to do next time.
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
          {st.state === "done" && <AiSource ai={ai}> · written when you finished</AiSource>}
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
          <div style={{ padding: "12px 0 16px" }}>
            <AiProblemLine problem={st.problem} onRetry={() => setAgain((n) => n + 1)} />
          </div>
        )}
        {st.state === "done" && (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink)", margin: "8px 0 10px" }}>{st.review.summary}</p>
            {st.review.patterns.map((p, k) => (
              <Pattern key={k} p={p} itemId={itemId} answers={answers} lang={lang} onShow={onShow} />
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

/** One reason, with a few of its words and the sentences; new words can all go to My words at once. */
function Pattern({ p, itemId, answers, lang, onShow }: { p: ReviewPattern; itemId: number; answers: Map<number, Answer>; lang: string; onShow: (n: number) => void }) {
  // The new words not in My words yet, each with the sentence it came from.
  const [toAdd, setToAdd] = useState<{ text: string; answer: Answer }[] | null>(null);
  const [adding, setAdding] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.reason !== "newWord") return;
    let live = true;
    const inSentence = (w: string) => {
      const plainWord = ` ${w.toLowerCase()} `;
      for (const n of p.sentences) {
        const a = answers.get(n - 1);
        if (a && ` ${a.original.toLowerCase().replace(/[^\p{L}\p{N}'’\s-]/gu, " ")} `.replace(/\s+/g, " ").includes(plainWord)) return a;
      }
      return answers.get((p.sentences[0] ?? 1) - 1) ?? null;
    };
    Promise.all(p.words.map(async (text) => ({ text, answer: inSentence(text), saved: await backend.wordSaved(text).catch(() => null) }))).then((all) => {
      if (live) setToAdd(all.filter((w) => w.saved === null && w.answer).map((w) => ({ text: w.text, answer: w.answer! })));
    });
    return () => {
      live = false;
    };
  }, [p, answers]);
  const addAll = async () => {
    if (!toAdd) return;
    setAdding("busy");
    setError(null);
    try {
      for (const w of toAdd) {
        await saveWordFrom(lang, { itemId, idx: w.answer.idx, sentence: w.answer.original, typed: w.answer.typed, text: w.text, meaning: "", explanation: "" });
      }
      setAdding("done");
    } catch (e) {
      setAdding("idle");
      setError(String(e));
    }
  };
  return (
    <div className="ai-pattern">
      <span className="ai-pattern-n">{p.count}</span>
      <div>
        {p.reason ? <ReasonTag reason={p.reason} many /> : <div style={{ font: "500 14px/1.4 var(--font-text)", color: "var(--ink)" }}>{p.title}</div>}
        <div className="ai-text" style={{ marginTop: 6 }}>
          {p.words.length > 0 && (
            <>
              {p.words.map((w, k) => (
                <span key={k}>
                  {k > 0 && ", "}
                  <span className="w w-missing">{w}</span>
                </span>
              ))}
              {": "}
            </>
          )}
          {p.explanation}
        </div>
        {p.reason === "newWord" && toAdd && (toAdd.length > 0 || adding === "done") && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            {adding === "done" ? (
              <span className="flag-label" style={{ color: "var(--semantic-success)" }}>
                <Icon name="check" size={14} />
                Added to My words
              </span>
            ) : (
              <button type="button" className="btn btn-sm" onClick={addAll} disabled={adding === "busy"}>
                <Icon name="plus" size={12} />
                {toAdd.length === 1 ? `Add ${toAdd[0].text} to My words` : `Add these ${toAdd.length} to My words`}
              </button>
            )}
            {error && (
              <span className="lookup-sub" role="alert">
                {error}
              </span>
            )}
          </div>
        )}
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
