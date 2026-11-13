// The card for words selected in a review or on Listen (DESIGN.md, "Results"): one word's meaning from the
// dictionary, or for several words one translation of them from the translator on this computer; the words as
// said in the episode or read slowly; and Add to My words. With AI set up (design D19), Explain (E) says what they
// mean in this sentence, and questions about them follow; the AI is asked by itself only when neither the
// dictionary nor the translator found anything. The explanation is kept with the word when it's added.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { aiProblem, backend, isTranslationModel, on, type AiProblem, type Entry, type Exchange, type Lookup } from "../lib/backend";
import { SETTINGS_AI, useAi } from "../lib/ai";
import { usePlayer } from "../lib/playback";
import { useActivity } from "../lib/transcripts";
import { firstLine, speak, useMeaningLanguage } from "../lib/words";
import { AiProblemLine, AiSource } from "./Ask";
import { Icon } from "./Icon";
import { Kbd } from "./Shell";

export type Selection = {
  itemId: number;
  idx: number;
  /** The selected written words of the sentence, from..=to. */
  from: number;
  to: number;
  text: string;
  typed: string;
  /** The whole sentence, for explaining the words in it. */
  sentence: string;
  rect: DOMRect;
};

const WIDTH = 360;

/** The translation of a selection of several words. */
type Machine = { state: "loading" } | { state: "done"; text: string } | { state: "missing" } | { state: "failed" };

/** What the AI said a selection means in its sentence, by language, sentence and words: asked once per run. */
type AskingWords = { question: string; text: string; problem: AiProblem | null };
const explained = new Map<string, string>();

/** Ready to show: the first translation also loads the model, which takes a few seconds. */
let translatorWarm = false;

/** `docked`: in a side panel (Listen) rather than floating by the selection. `onSaved`: told the text saved. */
export function LookupCard({
  sel,
  path,
  onClose,
  docked = false,
  onSaved,
}: {
  sel: Selection;
  path: string | null;
  onClose: () => void;
  docked?: boolean;
  onSaved?: (text: string) => void;
}) {
  const [lang] = useMeaningLanguage();
  const [result, setResult] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [times, setTimes] = useState<[number, number][]>([]);
  const player = usePlayer(path);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: sel.rect.bottom + 8, left: sel.rect.left });
  const [machine, setMachine] = useState<Machine | null>(null);
  const [translatorReady, setTranslatorReady] = useState(0);
  const { translation: translatorProgress } = useActivity();
  const { status: ai } = useAi();
  const navigate = useNavigate();
  // The conversation about these words: the explanation first (no question), then the learner's questions.
  const key = `${lang}|${sel.sentence}|${sel.text}`;
  const [talk, setTalk] = useState<Exchange[]>(() => {
    const known = explained.get(key);
    return known ? [{ question: "", answer: known }] : [];
  });
  const [asking, setAsking] = useState<AskingWords | null>(null);
  const [question, setQuestion] = useState("");
  const usingAi = !!ai?.using;
  const busy = !!asking && !asking.problem;
  // Another selection starts its own conversation; answers still coming for the last one are dropped.
  const generation = useRef(0);
  const shownKey = useRef(key);
  if (shownKey.current !== key) {
    shownKey.current = key;
    generation.current++;
  }
  useEffect(() => {
    const known = explained.get(key);
    setTalk(known ? [{ question: "", answer: known }] : []);
    setAsking(null);
    setQuestion("");
  }, [key]);

  const ask = (q: string | null, again = false) => {
    if (!usingAi || (busy && !again) || (q === null && talk.length > 0)) return;
    const mine = generation.current;
    const mineToo = () => mine === generation.current;
    setQuestion("");
    setAsking({ question: q ?? "", text: "", problem: null });
    backend.aiExplain(lang, sel.text, sel.sentence, talk, q, (t) => mineToo() && setAsking((a) => (a ? { ...a, text: a.text + t } : a))).then(
      (answer) => {
        if (talk.length === 0) explained.set(key, answer);
        if (!mineToo()) return;
        setTalk((t) => [...t, { question: q ?? "", answer }]);
        setAsking(null);
      },
      (e) => mineToo() && setAsking((a) => (a ? { ...a, problem: aiProblem(e) } : a)),
    );
  };

  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    backend.lookup(lang, sel.text).then(
      (r) => live && setResult(r),
      (e) => live && setError(String(e)),
    );
    backend.wordSaved(sel.text).then((id) => live && setSavedId(id));
    backend.wordTimes(sel.itemId, sel.idx).then((t) => live && setTimes(t), () => {});
    return () => {
      live = false;
    };
  }, [lang, sel.text, sel.itemId, sel.idx]);

  // Several words get one translation, read in their sentence; the learner doesn't need to know where it came
  // from. If the translator isn't here yet it starts downloading (normally it came when the app first opened),
  // and the translation follows once it has. Meanings in English have nothing to translate into, so they,
  // and a translation that fails, show the dictionary instead: the phrase, or each word.
  const several = !!result && result.words.length > 0;
  const wantsMachine = several && lang !== "en";
  useEffect(() => on("model-download", (p) => isTranslationModel(p.id) && p.state === "done" && setTranslatorReady((n) => n + 1)), []);
  useEffect(() => {
    if (!wantsMachine) return setMachine(null);
    let live = true;
    setMachine({ state: "loading" });
    backend.translate(lang, sel.itemId, sel.idx, sel.text).then(
      (t) => {
        if (!live) return;
        if (t.missing) {
          setMachine({ state: "missing" });
          backend.downloadTranslation().catch(() => {});
        } else if (t.text) {
          translatorWarm = true;
          setMachine({ state: "done", text: t.text });
        } else setMachine(null);
      },
      () => live && setMachine({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [wantsMachine, lang, sel.text, sel.itemId, sel.idx, translatorReady]);

  // Below the selection, or above it when there's no room; always inside the window.
  useLayoutEffect(() => {
    if (docked) return;
    const h = card.current?.offsetHeight ?? 300;
    const below = sel.rect.bottom + 8;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, sel.rect.top - h - 8) : below;
    const left = Math.min(Math.max(12, sel.rect.left), window.innerWidth - WIDTH - 12);
    setPos({ top, left });
  }, [sel.rect, result, error, docked, machine, talk.length, !!asking]);

  const save = async () => {
    if (!result || savedId) return;
    const entry = result.entry;
    const translated = machine?.state === "done" ? machine.text : null;
    const words = result.words.map((w) => `${w.text}${w.entry && w.entry.headword !== w.text ? ` (${w.entry.headword})` : ""}: ${w.entry ? firstLine(w.entry.meaning) : "—"}`);
    const fromDictionary = !translated && !!entry && result.whole;
    const meaning =
      translated ??
      (fromDictionary ? entry.meaning : machine ? "" : [entry ? `${entry.headword}: ${firstLine(entry.meaning)}` : null, ...words].filter(Boolean).join("\n"));
    try {
      const w = await backend.addWord({
        text: result.query || sel.text,
        headword: fromDictionary ? entry.headword : "",
        ipa: fromDictionary ? entry.ipa : "",
        meaning,
        note,
        explanation: talk[0]?.answer ?? "",
        itemId: sel.itemId,
        idx: sel.idx,
        from: sel.from,
        to: sel.to,
        typed: sel.typed,
      });
      setSavedId(w.id);
      onSaved?.(w.text);
    } catch (e) {
      setError(String(e));
    }
  };

  const asSaid = () => {
    const a = times[sel.from];
    const b = times[Math.min(sel.to, times.length - 1)];
    // A little air at both ends: word timings are a guess to within a tenth of a second or so.
    if (a && b) player.play(Math.max(0, a[0] - 100), b[1] + 120, 1);
  };

  // A adds, E explains, Esc closes; typing in the note is left alone.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea");
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      save();
    } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "e" && result) {
      e.preventDefault();
      ask(null);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    // Floating by the selection, a click elsewhere closes it; in the side panel (Listen) it stays until
    // another selection replaces it, or Esc.
    const onDown = (e: MouseEvent) => {
      if (!docked && card.current && !card.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose, docked]);

  const entry = result?.entry ?? null;
  const single = result ? result.words.length === 0 : !sel.text.trim().includes(" ");
  // The dictionary is shown for one word, and for several only when there's no translation to show.
  const dictionary = !!result && (single || !wantsMachine || machine?.state === "failed");
  const translated = machine?.state === "done";
  const title = dictionary && result?.whole && entry ? entry.headword : sel.text.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
  // Neither the dictionary nor the translator has anything: the AI is asked by itself.
  const nothingFound = !!result && !result.entry && result.words.every((w) => !w.entry) && (machine === null || machine.state === "failed");
  useEffect(() => {
    if (nothingFound && usingAi && talk.length === 0 && !asking) ask(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingFound, usingAi]);
  const explaining = talk.length > 0 || !!asking;
  // Nothing found and the AI explains it instead: no need for the learner's own note.
  const aiExplains = nothingFound && usingAi && explaining && !asking?.problem;

  return (
    <div ref={card} className={docked ? "lookup lookup-docked" : "lookup"} role="dialog" aria-label={title} style={docked ? undefined : { top: pos.top, left: pos.left, width: WIDTH }}>
      <div>
        <div className="h2" style={{ fontSize: 18 }}>
          {title}
        </div>
        {dictionary && result?.whole && entry && entry.headword !== result.query && <div className="lookup-sub">from “{result.query}”</div>}
        {dictionary && result?.whole && entry?.ipa && <div className="lookup-sub mono">{entry.ipa}</div>}
        {dictionary && result && !result.whole && !single && <div className="lookup-sub">Not in the dictionary as a phrase · each word</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={asSaid} disabled={!path || times.length === 0}>
          <Icon name="play" size={11} />
          As said in the episode
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => speak(sel.text)} title="Read by your computer's voice">
          <Icon name="speaker" size={14} />
          Slow voice
        </button>
      </div>

      {error && (
        <div className="notice notice-error" role="alert" style={{ fontSize: 13 }}>
          {error}
        </div>
      )}
      {!result && !error && <div className="lookup-sub">Looking it up… (the dictionary downloads once, about 5 MB)</div>}

      {machine && !dictionary && (
        <div aria-live="polite">
          {machine.state === "done" ? (
            <div className="lookup-translation">{machine.text}</div>
          ) : machine.state === "loading" ? (
            <div className="lookup-sub">{translatorWarm ? "Translating…" : "Translating… the first one takes a few seconds"}</div>
          ) : (
            <div className="lookup-sub">
              The translator is downloading{translatorProgress ? ` · ${Math.round((translatorProgress.received / translatorProgress.total) * 100)}%` : ""}. The
              translation shows here when it's ready.
            </div>
          )}
        </div>
      )}
      {dictionary && result.whole && entry && <Meaning entry={entry} />}
      {dictionary && !result.whole && entry && (
        <div className="lookup-found">
          <div className="lookup-sub">Phrase inside</div>
          <b>{entry.headword}</b>
          <span>{firstLine(entry.meaning)}</span>
        </div>
      )}
      {dictionary && single && !entry && (
        <div className="lookup-sub">{aiExplains ? "Not in the dictionary · explained by AI" : "Not in the dictionary. Add it with your own note."}</div>
      )}
      {dictionary && result.words.length > 0 && (
        <div>
          {result.words.map((w, i) => (
            <div key={i} className="wordline">
              <b>{w.text}</b>
              <span>
                {w.entry ? (
                  <>
                    <span className="mono lookup-ipa">
                      {w.entry.headword !== w.text && `→ ${w.entry.headword} `}
                      {w.entry.ipa}
                    </span>{" "}
                    {firstLine(w.entry.meaning)}
                  </>
                ) : (
                  <span style={{ color: "var(--ink-tertiary)" }}>not found</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {result && !translated && (!dictionary || !result.whole || !entry) && !savedId && !aiExplains && (
        <label className="lookup-note">
          Your note
          <span className="input">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your own meaning, in any language" />
          </span>
        </label>
      )}

      {result && usingAi && explaining && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)" }} aria-live="polite">
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="eyebrow">In this sentence</span>
            <span style={{ flexGrow: 1 }} />
            <AiSource ai={ai} />
          </div>
          {talk.map((t, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {t.question && <div className="ask-me">{t.question}</div>}
              <div className="ai-text">{t.answer}</div>
            </div>
          ))}
          {asking && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {asking.question && <div className="ask-me">{asking.question}</div>}
              {asking.problem ? (
                <AiProblemLine problem={asking.problem} onRetry={() => ask(asking.question || null, true)} onLeave={onClose} />
              ) : asking.text ? (
                <div className="ai-text">
                  {asking.text}
                  <span className="caret" aria-hidden="true" />
                </div>
              ) : (
                <div className="lookup-sub">Explaining…</div>
              )}
            </div>
          )}
          {talk.length > 0 && (
            <form
              className="ask-field lookup-ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) ask(question.trim());
              }}
            >
              <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about these words…" aria-label="Ask about these words" />
              <button type="submit" className="btn btn-sm btn-ghost" style={{ height: 24, padding: "0 6px" }} aria-label="Send" disabled={!question.trim() || busy}>
                <Icon name="send" size={12} stroke={2} />
              </button>
            </form>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)", flexWrap: "wrap" }}>
        {savedId ? (
          <span className="flag-label" style={{ color: "var(--semantic-success)" }}>
            <Icon name="check" size={14} />
            In My words
          </span>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!result || machine?.state === "loading"}>
            <Icon name="plus" size={13} />
            Add to My words <Kbd keys="A" />
          </button>
        )}
        {result && usingAi && !explaining && (
          <button type="button" className="btn btn-sm btn-ghost" style={{ color: "var(--ink)" }} onClick={() => ask(null)}>
            Explain in this sentence <Kbd keys="E" />
          </button>
        )}
        {result && ai && !usingAi && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Explaining words in their sentence needs AI"
            onClick={() => {
              onClose();
              navigate(SETTINGS_AI);
            }}
          >
            Set up AI to explain
          </button>
        )}
        {!savedId && talk.length > 0 && <span className="lookup-sub">The explanation is saved with it.</span>}
      </div>
      {dictionary && result?.source && <div className="lookup-credit">Meanings: {result.source}</div>}
    </div>
  );
}

function Meaning({ entry }: { entry: Entry }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-line" }}>{entry.meaning}</div>
      {entry.definition && <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-subtle)", whiteSpace: "pre-line" }}>{entry.definition}</div>}
    </div>
  );
}
