// The review of one attempt: the original and what was typed, side by side, with mistakes marked and the
// sentences flagged during dictation. Shown when stopping or finishing, and from the Episode page
// (`/library/:itemId/review/:attemptId`). Selecting words in the original opens the dictionary card.

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Icon } from "../components/Icon";
import { LookupCard, type Selection } from "../components/LookupCard";
import { IndexedText, MarkedText, selectedWords } from "../components/Marks";
import { Page } from "../components/Shell";
import { backend, on, type Answer, type Item, type Sentence, type Session, type Summary } from "../lib/backend";
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
  // Selecting words (a double-click, or a drag) looks them up, as on the Listen page.
  const onSelect = (i: number, e: MouseEvent<HTMLElement>) => {
    const root = e.currentTarget;
    window.setTimeout(() => {
      const range = selectedWords(root);
      const r = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (!range || !r) return;
      const text = answers.get(i)?.original ?? sentences[i]?.text ?? "";
      const words = text.split(/\s+/).filter(Boolean);
      setLookup({ itemId: item.id, idx: i, from: range[0], to: range[1], text: words.slice(range[0], range[1] + 1).join(" "), typed: answers.get(i)?.typed ?? "", rect: r.getBoundingClientRect() });
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
            <div key={i} className={`review-row${isFlagged ? " review-flagged" : ""}`}>
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
