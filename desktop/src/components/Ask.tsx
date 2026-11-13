// Asking the AI about one sentence (design D17): *Why did I miss this?*, answered by reason, and the learner's own
// questions, answered as they're written. The conversation is kept with the sentence: per attempt on Results, per
// episode on Listen. Also the pieces other AI places share: the reason tags and the line for a problem.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { problemText, saveWordFrom, SETTINGS_AI, useAi } from "../lib/ai";
import { aiProblem, backend, type AiMessage, type AiProblem, type AiStatus, type Reason, type WhyItem } from "../lib/backend";
import { useMeaningLanguage } from "../lib/words";
import { Icon, type IconName } from "./Icon";
import { Kbd } from "./Shell";

export const REASONS: Record<Reason, { label: string; many: string; icon: IconName | null }> = {
  newWord: { label: "New word", many: "New words", icon: "book" },
  soundsDifferent: { label: "Sounds different", many: "Sounds different", icon: "speaker" },
  didntCatch: { label: "Didn’t catch it", many: "Didn’t catch it", icon: "ear" },
  spelling: { label: "Spelling", many: "Spelling", icon: "pencil" },
  guessed: { label: "Guessed", many: "Guessed", icon: "guess" },
};

export function ReasonTag({ reason, many = false }: { reason: Reason; many?: boolean }) {
  const r = REASONS[reason] ?? REASONS.didntCatch;
  return (
    <span className="tag">
      {r.icon && <Icon name={r.icon} size={11} stroke={1.8} />}
      {many ? r.many : r.label}
    </span>
  );
}

export const sourceName = (ai: AiStatus | undefined) => (ai?.using === "chatgpt" ? "ChatGPT plan" : (ai?.key?.name ?? ""));

export function AiSource({ ai, children }: { ai: AiStatus | undefined; children?: ReactNode }) {
  return (
    <span className="ai-source">
      <span className="dot dot-ok" aria-hidden="true" />
      {sourceName(ai)}
      {children}
    </span>
  );
}

/** What went wrong, and the one thing to do about it: raise the limit, try again, or go to Settings › AI. */
export function AiProblemLine({ problem, onRetry, onLeave }: { problem: AiProblem; onRetry?: () => void; onLeave?: () => void }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} role="alert">
      <span className="lookup-sub" style={{ flexGrow: 1, minWidth: 180 }}>
        {problemText(problem)}
      </span>
      {problem.kind === "limit" ? (
        <button type="button" className="btn btn-sm" onClick={() => backend.manageUsage()}>
          Manage usage
          <Icon name="external" size={12} />
        </button>
      ) : problem.kind === "failed" ? (
        onRetry && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
            Try again
          </button>
        )
      ) : (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            onLeave?.();
            navigate(SETTINGS_AI);
          }}
        >
          Settings › AI
        </button>
      )}
    </div>
  );
}

export const WHY = "Why did I miss this?";
const MEANING = "What does it mean?";
const GRAMMAR = "Explain the grammar";

type Pending = { question: string; why: boolean; text: string; problem: AiProblem | null };

/** The conversation about one sentence, under its row (Results) or in the side panel (Listen). */
export function AskPanel({
  itemId,
  attemptId,
  idx,
  sentence,
  typed,
  mistakes,
  onPlaySlowly,
  onClose,
  docked = false,
}: {
  itemId: number;
  attemptId: number | null;
  idx: number;
  /** The sentence as written, and what was typed: for adding a new word to My words. */
  sentence: string;
  typed: string;
  /** There are mistakes to explain: offers *Why did I miss this?*. */
  mistakes: boolean;
  onPlaySlowly: (() => void) | null;
  onClose: () => void;
  docked?: boolean;
}) {
  const { status: ai } = useAi();
  const [lang] = useMeaningLanguage();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AiMessage[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    backend.aiThread(itemId, attemptId, idx).then(
      (m) => live && setMessages(m),
      () => live && setMessages([]),
    );
    return () => {
      live = false;
    };
  }, [itemId, attemptId, idx]);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // The newest at the bottom stays in view while it's written.
  useEffect(() => {
    const t = thread.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [messages, pending?.text, pending?.problem]);

  const send = (question: string, why: boolean) => {
    const q = question.trim();
    if ((!q && !why) || (pending && !pending.problem)) return;
    setInput("");
    setPending({ question: why ? WHY : q, why, text: "", problem: null });
    backend
      .aiAsk(lang, itemId, attemptId, idx, q, why, (t) => setPending((p) => (p ? { ...p, text: p.text + t } : p)))
      .then(
        (m) => {
          setMessages((ms) => [...(ms ?? []), m]);
          setPending(null);
        },
        (e) => setPending((p) => (p ? { ...p, problem: aiProblem(e) } : p)),
      );
  };

  const label = `Ask about sentence ${idx + 1}`;
  if (ai && !ai.using)
    return (
      <div className={docked ? "ask ask-docked ask-off" : "ask ask-off"} role="region" aria-label="AI not set up">
        <div style={{ flexGrow: 1 }}>
          <div className="account-row-t">Ask the AI about this sentence</div>
          <div className="account-row-h">Why you missed it, what it means, the grammar, or your own question. Connect ChatGPT Plus or your own API key once, in Settings › AI.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => navigate(SETTINGS_AI)}>
          Set up AI
        </button>
      </div>
    );

  const asked = new Set((messages ?? []).map((m) => m.question));
  const chips = [mistakes && WHY, MEANING, GRAMMAR].filter((c): c is string => !!c && !asked.has(c));
  const empty = messages !== null && messages.length === 0 && !pending;
  const busy = !!pending && !pending.problem;

  return (
    <div className={docked ? "ask ask-docked" : "ask"} role="region" aria-label={label}>
      <div className="ask-head">
        <span className="h2" style={{ fontSize: 13 }}>
          {docked ? `Ask about sentence ${idx + 1}` : "Ask about this sentence"}
        </span>
        {!docked && <AiSource ai={ai} />}
        <span style={{ flexGrow: 1 }} />
        {!docked && <span className="ai-source">The sentence{attemptId !== null ? ", what you typed," : ""} and the sentences around it are sent</span>}
        <button type="button" className="btn btn-ghost ask-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="ask-thread" ref={thread} aria-live="polite">
        {empty && (
          <div className="lookup-sub" style={{ fontSize: 13 }}>
            Ask anything about sentence {idx + 1}: {mistakes ? "why you missed it, " : ""}what it means, the grammar. In any language.
          </div>
        )}
        {messages?.map((m) => (
          <Exchange key={m.id} question={m.question}>
            {m.why ? (
              m.why.items.map((w, k) => (
                <ReasonCard key={k} item={w} onPlaySlowly={onPlaySlowly} save={(explanation) => saveWordFrom(lang, { itemId, idx, sentence, typed, text: w.original, meaning: w.meaning, explanation })} />
              ))
            ) : (
              <div className="ai-text">{m.answer}</div>
            )}
          </Exchange>
        ))}
        {pending && (
          <Exchange question={pending.question}>
            {pending.problem ? (
              <AiProblemLine problem={pending.problem} onRetry={() => send(pending.why ? "" : pending.question, pending.why)} />
            ) : pending.why ? (
              <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="lookup-sub">Working out why…</span>
                <div className="skel" style={{ width: "86%" }} />
                <div className="skel" style={{ width: "64%" }} />
              </div>
            ) : (
              <div className="ai-text">
                {pending.text}
                <span className="caret" aria-hidden="true" />
              </div>
            )}
          </Exchange>
        )}
      </div>
      <div className="ask-composer">
        {chips.length > 0 && (
          <div className="ask-chips">
            {chips.map((c) => (
              <button key={c} type="button" className="ask-chip" disabled={busy} onClick={() => send(c === WHY ? "" : c, c === WHY)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <form
          className="ask-field"
          onSubmit={(e) => {
            e.preventDefault();
            send(input, false);
          }}
        >
          <input
            ref={field}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder={messages?.length ? "Ask a follow-up…" : "Ask about this sentence…"}
            aria-label={label}
          />
          {!docked && <Kbd keys="Enter" />}
          <button type="submit" className="btn btn-sm btn-primary" style={{ height: 26, padding: "0 8px" }} aria-label="Send" disabled={!input.trim() || busy}>
            <Icon name="send" size={12} stroke={2} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Exchange({ question, children }: { question: string; children: ReactNode }) {
  return (
    <>
      <div className="ask-me">{question}</div>
      <div className="ask-ai">{children}</div>
    </>
  );
}

/** One reason a mistake happened, with what helps: a new word goes to My words, a sound is played slowly. */
function ReasonCard({ item: w, onPlaySlowly, save }: { item: WhyItem; onPlaySlowly: (() => void) | null; save: (explanation: string) => Promise<unknown> }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (w.reason !== "newWord") return;
    let live = true;
    backend.wordSaved(w.original).then((id) => live && setSaved(id !== null));
    return () => {
      live = false;
    };
  }, [w.reason, w.original]);
  return (
    <div className="reason">
      <ReasonTag reason={w.reason} />
      <div>
        <span className="w w-missing">{w.original}</span>
        {w.typed && (
          <>
            {" "}
            <span className="muted">→</span> <span className="w w-wrong">{w.typed}</span>
          </>
        )}
        {(w.said || w.meaning) && <div className="why-said">{[w.said, w.meaning].filter(Boolean).join(" · ")}</div>}
        <div className="ai-text" style={{ marginTop: 6 }}>
          {w.why}
        </div>
        {error && (
          <div className="lookup-sub" role="alert" style={{ color: "var(--semantic-error)" }}>
            {error}
          </div>
        )}
      </div>
      {w.reason === "newWord" ? (
        saved ? (
          <span className="flag-label" style={{ color: "var(--semantic-success)", whiteSpace: "nowrap" }}>
            <Icon name="check" size={14} />
            In My words
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={saved === null}
            onClick={() =>
              save(w.why).then(
                () => setSaved(true),
                (e) => setError(String(e)),
              )
            }
          >
            <Icon name="plus" size={12} />
            Add to My words
          </button>
        )
      ) : (w.reason === "soundsDifferent" || w.reason === "didntCatch") && onPlaySlowly ? (
        <button type="button" className="btn btn-sm" onClick={onPlaySlowly}>
          <Icon name="play" size={11} />
          Play at 0.7×
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
