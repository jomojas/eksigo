// Word practice (design D10): today's words, each in a sentence it was saved from, played as said.
// Three ways: type the missing words, recall the meaning, or pick it from four. The learner decides as
// little as possible: a wrong answer counts as Again by itself and comes back at the end of the session;
// a right one is Good unless they press 2 (Hard) or 4 (Easy).

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";
import { backend, type PracticeItem, type PracticeMode } from "../lib/backend";
import { clock, interval, plural } from "../lib/format";
import { usePlayer } from "../lib/playback";
import { modKey } from "../lib/platform";
import { speak, usePracticeCounts } from "../lib/words";

const MODES: [PracticeMode, string][] = [
  ["type", "Listen and type"],
  ["recall", "Listen and recall"],
  ["pick", "Pick the meaning"],
];
const GRADES = ["Again", "Hard", "Good", "Easy"] as const;
type Grade = 1 | 2 | 3 | 4;
/** A missed word comes back at most this many times in one session. */
const MAX_AGAIN = 2;
const MODE_KEY = "practiceMode";

type Answer = { correct: boolean | null; typed: string; picked: number | null };

export function Practice() {
  const navigate = useNavigate();
  const counts = usePracticeCounts();
  const [mode, setModeState] = useState<PracticeMode>("type");
  const [queue, setQueue] = useState<PracticeItem[] | null>(null);
  const [pos, setPos] = useState(0);
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ words: new Set<number>(), again: 0 });
  const [done, setDone] = useState(false);
  const shownAt = useRef(Date.now());
  const againCount = useRef(new Map<number, number>());
  const box = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    setDone(false);
    setPos(0);
    setAnswer(null);
    setTyped("");
    setStats({ words: new Set(), again: 0 });
    againCount.current = new Map();
    backend.practiceQueue().then(setQueue, (e) => setError(String(e)));
  }, []);
  useEffect(() => {
    backend.getSetting(MODE_KEY).then((m) => m && MODES.some(([x]) => x === m) && setModeState(m as PracticeMode));
    load();
  }, [load]);
  const setMode = (m: PracticeMode) => {
    setModeState(m);
    backend.setSetting(MODE_KEY, m);
    box.current?.focus();
  };

  const item = queue && !done ? queue[pos] ?? null : null;
  const pickPossible = !!queue?.some((q) => q.choices.length === 4);
  // The way this word is practised: typing needs the word in the sentence, picking needs four meanings.
  const how: PracticeMode | null = !item
    ? null
    : mode === "type" && !item.gap
      ? "recall"
      : mode === "pick" && item.choices.length < 4
        ? item.gap
          ? "type"
          : "recall"
        : mode;

  // ---------- sound ----------

  const player = usePlayer(item?.context.path ?? null);
  const play = useCallback(
    (slow = false) => {
      if (!item) return;
      const c = item.context;
      if (c.path) player.play(c.sentenceStartMs, c.sentenceEndMs, slow ? 0.75 : 1);
      else speak(c.sentence, slow ? 0.6 : 0.9);
    },
    [item, player],
  );
  // Each word starts by playing its sentence.
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!item) return;
    shownAt.current = Date.now();
    const t = window.setTimeout(() => playRef.current(), 150);
    box.current?.focus();
    return () => window.clearTimeout(t);
  }, [item]);

  // ---------- answering ----------

  const check = async () => {
    if (!item || answer || !typed.trim()) return;
    const correct = await backend.practiceCheck(item.word.text, typed);
    setAnswer({ correct, typed, picked: null });
  };
  const showAnswer = () => item && !answer && setAnswer({ correct: how === "recall" ? null : false, typed, picked: null });
  const pick = (i: number) => {
    if (!item || answer || how !== "pick") return;
    setAnswer({ correct: item.choices[i] === item.answer, typed: "", picked: i });
  };

  const allowed: Grade[] = !answer ? [] : answer.correct === false ? [1] : answer.correct === true ? [2, 3, 4] : [1, 2, 3, 4];
  const usual: Grade = answer?.correct === false ? 1 : 3;

  const grade = async (g: Grade) => {
    if (!item || !answer || !allowed.includes(g) || !queue || !how) return;
    try {
      await backend.practiceGrade({
        wordId: item.word.id,
        itemId: item.context.itemId,
        idx: item.context.idx,
        mode: how,
        grade: g,
        correct: answer.correct,
        typed: answer.picked != null ? item.choices[answer.picked] : answer.typed,
        seconds: Math.round((Date.now() - shownAt.current) / 1000),
      });
    } catch (e) {
      setError(String(e));
      return;
    }
    player.stop();
    window.speechSynthesis?.cancel();
    const words = new Set(stats.words).add(item.word.id);
    let next = queue;
    const n = againCount.current.get(item.word.id) ?? 0;
    if (g === 1 && n < MAX_AGAIN) {
      // Missed: once more at the end of this session (a copy, so it plays again).
      againCount.current.set(item.word.id, n + 1);
      next = [...queue, { ...item }];
      setQueue(next);
    }
    setStats({ words, again: stats.again + (g === 1 ? 1 : 0) });
    setAnswer(null);
    setTyped("");
    if (pos + 1 >= next.length) setDone(true);
    else setPos(pos + 1);
  };

  const end = () => {
    player.stop();
    window.speechSynthesis?.cancel();
    if (stats.words.size > 0 && !done) setDone(true);
    else navigate("/words");
  };

  // ---------- keys ----------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.isComposing) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") return stop(), end();
    if (done) {
      if (e.key === "Enter") stop(), navigate("/words");
      return;
    }
    if (!item) return;
    if (modKey(e) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "r" || e.code === "KeyR")) return stop(), play(true);
    if (e.key === "Tab" && e.shiftKey) return stop(), showAnswer();
    if (e.key === "Tab") return stop(), play();
    if (modKey(e) || e.altKey) return;
    if (!answer) {
      if (how === "type" && e.key === "Enter") return stop(), check();
      if (how === "recall" && (e.key === " " || e.key === "Enter")) return stop(), showAnswer();
      if (how === "pick" && /^[1-4]$/.test(e.key)) return stop(), pick(Number(e.key) - 1);
      return;
    }
    if (e.key === "Enter") return stop(), grade(usual);
    if (/^[1-4]$/.test(e.key)) return stop(), grade(Number(e.key) as Grade);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ---------- view ----------

  const total = queue?.length ?? 0;
  const pageKeys: [string, string][] = done
    ? [
        ["Enter", "My words"],
        ["Esc", "Back"],
      ]
    : [
        ["Tab", "Play again"],
        ["Enter", !answer ? (how === "type" ? "Check" : how === "recall" ? "Show" : "—") : "Next"],
        ["Shift Tab", "Show the answer"],
        ["Esc", "End"],
      ];

  return (
    <Page crumbs={[{ label: "My words", to: "/words" }, "Practice"]} keys={pageKeys}>
      <section style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 24px 40px", gap: 24 }}>
        <div style={{ width: "100%", maxWidth: 640, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="pills" role="group" aria-label="How to practise">
            {MODES.map(([m, label]) => (
              <button
                key={m}
                type="button"
                className="pill"
                aria-pressed={mode === m}
                disabled={m === "pick" && queue !== null && !pickPossible}
                title={m === "pick" && queue !== null && !pickPossible ? "Needs at least four words with meanings in My words" : undefined}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ flexGrow: 1 }} />
          {item && (
            <>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                {pos + 1} / {total}
              </span>
              <span className="track" style={{ width: 100 }}>
                <span className="fill" style={{ display: "block", width: `${(pos / Math.max(total, 1)) * 100}%` }} />
              </span>
            </>
          )}
        </div>

        {error && (
          <div className="notice notice-error" role="alert" style={{ width: "100%", maxWidth: 640 }}>
            {error}
          </div>
        )}

        {queue && queue.length === 0 && !done && (
          <div className="empty" style={{ maxWidth: 640 }}>
            <h2 className="h2">Nothing to practise right now</h2>
            <p>
              {counts && counts.total === 0 && "Words you've practised come back when they're due. "}
              Save words from a review to practise them; up to ten new ones start each day.
            </p>
            <button type="button" className="btn" onClick={() => navigate("/words")}>
              Back to My words
            </button>
          </div>
        )}

        {done && <Finished practised={stats.words.size} again={stats.again} more={counts?.total ?? 0} onMore={load} />}

        {item && how && (
          <>
            <article className="panel" style={{ width: "100%", maxWidth: 640, padding: 28, display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button
                  type="button"
                  className="btn"
                  aria-label="Play the sentence"
                  onClick={() => play()}
                  style={{ width: 48, height: 48, padding: 0, borderRadius: 9999, flexShrink: 0 }}
                >
                  <Icon name={player.playing ? "pause" : "play"} size={18} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--ink)" }}>
                    {how === "type" ? "Listen, and type the missing words" : how === "recall" ? "What does it mean here?" : "Pick its meaning"}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {item.context.path ? (
                      <span>
                        {item.context.itemTitle} · {clock(item.context.sentenceStartMs / 1000)}
                      </span>
                    ) : (
                      <span>Read by your computer's voice: the episode is no longer in your library</span>
                    )}
                    <span>·</span>
                    <Kbd keys="Tab" /> again <Kbd keys="Mod R" /> slower
                  </div>
                </div>
              </div>

              {how !== "type" && (
                <div className="h2" style={{ fontSize: 22 }}>
                  {item.word.text}
                </div>
              )}
              <Sentence item={item} how={how} answer={answer} />

              {how === "type" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label htmlFor="practice-answer" className="eyebrow">
                    The missing words
                  </label>
                  <input
                    id="practice-answer"
                    ref={box}
                    value={answer ? answer.typed : typed}
                    readOnly={!!answer}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setTyped(e.target.value)}
                    className="practice-box"
                    data-result={answer ? (answer.correct ? "right" : "wrong") : undefined}
                  />
                </div>
              )}

              {how === "pick" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
                  {item.choices.map((c, i) => {
                    const state = !answer ? undefined : c === item.answer ? "right" : answer.picked === i ? "wrong" : "off";
                    return (
                      <button key={i} type="button" className="btn choice" data-result={state} onClick={() => pick(i)} disabled={!!answer && state === "off"}>
                        <Kbd keys={String(i + 1)} />
                        <span style={{ whiteSpace: "normal", textAlign: "left", flexGrow: 1 }}>{c}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!answer && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {how === "type" && (
                    <button type="button" className="btn btn-primary" onClick={check} disabled={!typed.trim()}>
                      Check <Kbd keys="Enter" />
                    </button>
                  )}
                  {how === "recall" && (
                    <button type="button" className="btn btn-primary" onClick={showAnswer}>
                      Show the meaning <Kbd keys="Space" />
                    </button>
                  )}
                  {how !== "recall" && (
                    <button type="button" className="btn btn-ghost" onClick={showAnswer}>
                      Show the answer <Kbd keys="Shift Tab" />
                    </button>
                  )}
                </div>
              )}

              {answer && <Result item={item} how={how} answer={answer} />}
            </article>

            <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="eyebrow">
                {!answer
                  ? "After answering"
                  : answer.correct === false
                    ? "Counts as Again: it comes back at the end of this session, and tomorrow"
                    : answer.correct === true
                      ? "Right. Enter for Good, or 2 if it was hard, 4 if it was easy"
                      : "How well did you know it? Enter for Good"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                {GRADES.map((label, i) => {
                  const g = (i + 1) as Grade;
                  const on = allowed.includes(g);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`btn${on && g === usual ? " btn-primary" : ""}`}
                      disabled={!on}
                      onClick={() => grade(g)}
                      style={{ height: 52, flexDirection: "column", gap: 4, opacity: on ? 1 : 0.4 }}
                    >
                      <span>
                        {label} <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{g}</span>
                      </span>
                      <span className="mono" style={{ fontSize: 11, opacity: 0.75 }}>
                        {interval(item.next[i])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </Page>
  );
}

/** The sentence: with a gap while typing, the word marked otherwise. */
function Sentence({ item, how, answer }: { item: PracticeItem; how: PracticeMode; answer: Answer | null }) {
  const style = { fontSize: 18, lineHeight: 1.6, color: "var(--ink)" };
  if (!item.gap) return <p style={style}>{item.context.sentence}</p>;
  const [before, word, after] = item.gap;
  if (how === "type" && !answer)
    return (
      <p style={style}>
        {before}
        <span className="gap" style={{ width: `${Math.max(4, word.length) * 0.62}em` }} aria-label="missing words" />
        {after}
      </p>
    );
  return (
    <p style={style}>
      {before}
      <span className={how === "type" ? (answer?.correct ? "answer-right" : "answer-wrong") : "sel-mark"}>{word}</span>
      {after}
    </p>
  );
}

/** After answering: what was right, and the meaning. */
function Result({ item, how, answer }: { item: PracticeItem; how: PracticeMode; answer: Answer }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
      {how === "type" && answer.correct === false && (
        <div style={{ fontSize: 13 }}>
          {answer.typed.trim() ? (
            <>
              You typed <span className="answer-wrong">{answer.typed.trim()}</span> · it's <b style={{ color: "var(--ink)" }}>{item.word.text}</b>
            </>
          ) : (
            <>
              It's <b style={{ color: "var(--ink)" }}>{item.word.text}</b>
            </>
          )}
        </div>
      )}
      {how !== "pick" && (
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-line" }}>
          {item.answer || <span className="muted">No meaning saved. Add a note in My words.</span>}
        </div>
      )}
      {item.word.ipa && (
        <div className="mono muted" style={{ fontSize: 12 }}>
          {item.word.ipa}
        </div>
      )}
    </div>
  );
}

function Finished({ practised, again, more, onMore }: { practised: number; again: number; more: number; onMore: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="panel" style={{ width: "100%", maxWidth: 640, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 className="h1">Done for now</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        You practised {plural(practised, "word")}
        {again > 0 ? `; you missed ${plural(again, "time")}, and those words come back tomorrow.` : ", all of them right."} The rest come back when they're due.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/words")}>
          My words <Kbd keys="Enter" />
        </button>
        {more > 0 && (
          <button type="button" className="btn" onClick={onMore}>
            Practise {more} more
          </button>
        )}
      </div>
    </div>
  );
}
