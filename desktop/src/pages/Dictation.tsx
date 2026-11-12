// Dictation: the episode one sentence at a time, built for the keyboard (DESIGN.md, "The dictation loop").
// `/library/:itemId/dictation`. Progress is saved with every sentence, so leaving at any point loses nothing
// but the sentence being typed.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { PlaybackSettings } from "../components/DictationSettings";
import { Icon } from "../components/Icon";
import { Kbd, Page, useFocusMode } from "../components/Shell";
import { backend, type Item, type Sentence, type Session, type Show, type Summary, type TranscriptStatus } from "../lib/backend";
import { fraction, useDownloads, useLibraryChanged } from "../lib/downloads";
import { clampSpeed, pauseMs, slowerSpeed, SPEED_STEP, speedLabel, useDictationSettings } from "../lib/dictation";
import { bytes, clock, plural } from "../lib/format";
import { modKey } from "../lib/platform";
import { sentenceAt, usePlayer } from "../lib/playback";
import { isBusy, useActivity, useTranscript } from "../lib/transcripts";
import { Review } from "./Review";

type Phase = "dictating" | "ad" | "stop" | "results";

const KEYS: [string, string][] = [
  ["Tab", "Play"],
  ["Shift Enter", "Finish"],
  ["Shift Tab", "Know it"],
  ["Mod D", "Flag"],
  ["Mod P", "Play anyway"],
  ["Mod R", "Slower"],
  ["Esc", "Stop"],
];

export function DictationScreen() {
  const itemId = Number(useParams().itemId);
  const navigate = useNavigate();
  const location = useLocation();
  const again = !!(location.state as { again?: boolean } | null)?.again;
  const [item, setItem] = useState<Item | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItem = useCallback(async () => {
    try {
      const it = await backend.item(itemId);
      setItem(it);
      if (it.episodeId) setShow((await backend.getEpisode(it.episodeId)).show);
    } catch (e) {
      setError(String(e));
    }
  }, [itemId]);
  useEffect(() => {
    loadItem();
  }, [loadItem]);
  useLibraryChanged(loadItem);

  // The attempt: the unfinished one, or a new one when asked to practise again.
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    backend.startDictation(itemId, again).then(setSession, (e) => setError(String(e)));
    // Coming back to this page later carries on; it doesn't start yet another attempt.
    if (again) navigate(location.pathname, { replace: true, state: null });
  }, [itemId, again, navigate, location.pathname]);

  // The transcript, growing while the learner dictates.
  const [initial, setInitial] = useState<TranscriptStatus | null>(null);
  useEffect(() => {
    backend.transcriptStatus(itemId).then(setInitial);
  }, [itemId]);
  const status = useTranscript(itemId, initial);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const count = status?.sentences ?? 0;
  useEffect(() => {
    if (count > 0) backend.sentences(itemId).then(setSentences);
  }, [itemId, count]);

  // A downloaded episode with no transcript yet starts transcribing as soon as dictation opens.
  const asked = useRef(false);
  useEffect(() => {
    if (item?.state === "ready" && status?.state === "none" && !asked.current) {
      asked.current = true;
      backend.transcribe(itemId);
    }
  }, [item?.state, status?.state, itemId]);

  const title = item?.title ?? "…";
  const crumbs = [
    { label: "Library", to: "/library" },
    ...(show ? [{ label: show.title, to: `/podcasts/show/${show.id}` }] : []),
    { label: title, to: `/library/${itemId}` },
  ];

  const ready = item?.state === "ready" && session && sentences.length > 0;
  if (!ready || !item || !session || !status) {
    return (
      <Page crumbs={crumbs}>
        <div className="page">
          {error ? (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          ) : (
            <Preparing item={item} status={status} onRetry={() => backend.transcribe(itemId)} onBack={() => navigate(`/library/${itemId}`)} />
          )}
        </div>
      </Page>
    );
  }
  return <Dictation key={session.attempt.id} item={item} crumbs={crumbs} session={session} sentences={sentences} status={status} onAgain={setSession} />;
}

/** Before the first sentence: the download, the speech model, the first chunk of transcript. */
function Preparing({ item, status, onRetry, onBack }: { item: Item | null; status: TranscriptStatus | null; onRetry: () => void; onBack: () => void }) {
  const progress = useDownloads().get(item?.id ?? -1);
  const { model } = useActivity();
  let body: ReactNode = "Opening…";
  if (item?.state === "downloading") {
    const f = fraction(progress);
    body = (
      <>
        <Bar f={f ?? 0} />
        <span>Downloading the episode{progress ? ` · ${bytes(progress.received)}${progress.total ? ` of ${bytes(progress.total)}` : ""}` : ""}. Dictation opens when it's here.</span>
      </>
    );
  } else if (item?.state === "failed" || item?.state === "missing") {
    return (
      <div className="notice notice-error" role="alert">
        <span style={{ flexGrow: 1 }}>{item.state === "failed" ? item.error ?? "The download failed." : "The audio file can't be found."}</span>
        <button type="button" className="btn btn-sm" onClick={onBack}>
          Back to the episode
        </button>
      </div>
    );
  } else if (status?.state === "failed") {
    return (
      <div className="notice notice-error" role="alert">
        <span style={{ flexGrow: 1 }}>{status.error ?? "Transcription failed."}</span>
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  } else if (status?.state === "model" && model) {
    body = (
      <>
        <Bar f={model.received / model.total} />
        <span>
          Downloading the speech model, once · {bytes(model.received)} of {bytes(model.total)}
        </span>
      </>
    );
  } else if (status && (isBusy(status.state) || status.state === "none")) {
    body = (
      <>
        <span className="dot dot-ring" aria-hidden="true" />
        <span>Getting the first sentences ready. Dictation starts in about half a minute, and the rest is transcribed while you type.</span>
      </>
    );
  } else if (status?.state === "done") {
    body = "This audio has no speech Eksigo could find.";
  }
  return (
    <div className="panel" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }} role="status">
      {body}
    </div>
  );
}

function Bar({ f }: { f: number }) {
  return (
    <span className="track" style={{ width: 160, flexShrink: 0 }}>
      <span className="fill" style={{ display: "block", width: `${Math.round(f * 100)}%` }} />
    </span>
  );
}

function Dictation({
  item,
  crumbs,
  session,
  sentences,
  status,
  onAgain,
}: {
  item: Item;
  crumbs: { label: string; to: string }[];
  session: Session;
  sentences: Sentence[];
  status: TranscriptStatus;
  onAgain: (s: Session) => void;
}) {
  const navigate = useNavigate();
  const attemptId = session.attempt.id;
  const [settings, update] = useDictationSettings();
  const speed = settings.speed;
  const player = usePlayer(item.path);
  const [focus, setFocus] = useFocusMode();
  const box = useRef<HTMLTextAreaElement>(null);

  const [answers, setAnswers] = useState(() => new Map(session.answers.map((a) => [a.idx, a])));
  const [pos, setPos] = useState(session.attempt.position);
  const drafts = useRef(new Map<number, string>());
  const [text, setText] = useState(() => answers.get(session.attempt.position)?.typed ?? "");
  // Each sentence keeps its plays when moving back and forth; answered ones start from their saved answer.
  const [playsBy, setPlaysBy] = useState(() => new Map(session.answers.map((a) => [a.idx, a.plays])));
  const plays = playsBy.get(pos) ?? 0;
  // Sentences flagged to look at in the review; a flag can be set before answering.
  const [flagged, setFlagged] = useState(() => new Set(session.flagged));
  const [phase, setPhase] = useState<Phase>("dictating");
  const [adFrom, setAdFrom] = useState(0);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  const done = status.state === "done";
  const sentence = sentences[pos] as Sentence | undefined;
  const total = done ? sentences.length : null;

  // Time spent, counted between saves; a long absence is capped by the core.
  const lastSave = useRef(Date.now());
  const secondsSince = useCallback(() => {
    const s = Math.round((Date.now() - lastSave.current) / 1000);
    lastSave.current = Date.now();
    return s;
  }, []);
  const [secondsBase, setSecondsBase] = useState(session.attempt.seconds);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const addSeconds = (s: number) => setSecondsBase((b) => b + Math.min(s, 180));

  // Leaving the page keeps where the learner is.
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(
    () => () => {
      backend.savePosition(attemptId, posRef.current, Math.round((Date.now() - lastSave.current) / 1000)).catch(() => {});
      setFocus(false);
    },
    [attemptId, setFocus],
  );

  const focusBox = () => {
    window.setTimeout(() => box.current?.focus(), 0);
  };
  // The typing box appears when the sentence does (also after waiting for the transcript).
  const hasSentence = !!sentence;
  useEffect(() => {
    if (hasSentence) focusBox();
  }, [hasSentence]);

  // ---------- playing ----------

  const autoTimer = useRef<number | null>(null);
  /** The sentence a counted play is for; cleared by anything that stops it on purpose. */
  const playingFor = useRef<number | null>(null);
  const clearAuto = () => {
    if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
    playingFor.current = null;
  };

  /** Plays the sentence once, as one of its plays. Past the maximum only when `anyway` (Mod P). */
  const playSentence = useCallback(
    (sp = speed, anyway = false) => {
      if (!sentence) return false;
      if (plays >= settings.maxPlays && !anyway) {
        setNote("No plays left for this sentence.");
        return false;
      }
      clearAuto();
      player.play(sentence.startMs, sentence.endMs, sp);
      setPlaysBy((m) => new Map(m).set(pos, plays + 1));
      playingFor.current = pos;
      setNote("");
      return true;
    },
    [sentence, plays, settings.maxPlays, speed, player, pos],
  );

  // Auto mode: when a play ends by itself, the next starts after the pause, up to the maximum.
  const wasPlaying = useRef(false);
  useEffect(() => {
    const ended = wasPlaying.current && !player.playing;
    wasPlaying.current = player.playing;
    if (!ended || playingFor.current !== pos || phase !== "dictating" || settings.mode !== "auto" || !sentence || plays >= settings.maxPlays) return;
    clearAuto();
    autoTimer.current = window.setTimeout(() => playSentence(), pauseMs(settings, sentence.endMs - sentence.startMs, speed));
  }, [player.playing, phase, settings, sentence, plays, playSentence, speed, pos]);
  useEffect(() => clearAuto, [pos, settings.mode]);

  const setSpeed = useCallback(
    (v: number) => {
      const s = clampSpeed(v);
      update({ speed: s });
      // A sentence playing carries on at the new speed from where it is.
      if (player.playing) player.play(player.positionMs, phase === "ad" || !sentence ? null : sentence.endMs, s);
    },
    [update, player, phase, sentence],
  );

  const slow = () => {
    const sp = slowerSpeed(speed, settings.slowSpeed);
    if (playSentence(sp)) setNote(`Played once at ${speedLabel(sp)}.`);
  };

  // ---------- moving ----------

  const goTo = useCallback(
    (i: number, save: boolean) => {
      drafts.current.set(posRef.current, box.current?.value ?? "");
      clearAuto();
      player.stop();
      setPos(i);
      setText(drafts.current.get(i) ?? answers.get(i)?.typed ?? "");
      setNote("");
      if (save) {
        const s = secondsSince();
        addSeconds(s);
        backend.savePosition(attemptId, i, s).catch((e) => setNote(String(e)));
      }
      focusBox();
    },
    [answers, attemptId, player, secondsSince],
  );

  /** Shift Enter submits what's typed; Shift Tab ("I know this one") moves on without typing. */
  const submit = async (kind: "typed" | "known") => {
    if (!sentence || busy) return;
    setBusy(true);
    try {
      const s = secondsSince();
      addSeconds(s);
      const a = await backend.answer(attemptId, pos, kind, kind === "typed" ? text : "", plays, s);
      setAnswers((m) => new Map(m).set(pos, a));
      goTo(pos + 1, false);
      drafts.current.delete(pos);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  const jump = (i: number) => {
    if (i !== pos) goTo(i, true);
  };

  /** Mod D: flag this sentence for the review, or take the flag off. */
  const toggleFlag = (i = pos) => {
    const v = !flagged.has(i);
    setFlagged((f) => {
      const n = new Set(f);
      if (v) n.add(i);
      else n.delete(i);
      return n;
    });
    backend.flag(attemptId, i, v).catch((e) => setNote(String(e)));
  };
  const move = (d: number) => jump(Math.max(0, Math.min(pos + d, sentences.length)));
  /** Mod ↓: back to the first sentence not done yet. */
  const firstNotDone = () => {
    let i = 0;
    while (i < sentences.length && answers.has(i)) i++;
    return i;
  };

  // ---------- ads ----------

  const adAt = phase === "ad" && player.playing ? Math.max(adFrom, sentenceAt(sentences, player.positionMs)) : adFrom;
  const toggleAd = async () => {
    if (phase === "ad") {
      // The episode is back: everything before the sentence being heard was the ad.
      const to = adAt;
      player.stop();
      setPhase("dictating");
      if (to > adFrom) {
        const s = secondsSince();
        addSeconds(s);
        await backend.markAds(attemptId, adFrom, to, s);
        setAnswers((m) => {
          const n = new Map(m);
          for (let i = adFrom; i < to; i++)
            n.set(i, { idx: i, kind: "ad", original: sentences[i].text, typed: "", plays: 0, credit: 0, total: 0, spelling: 0, comparison: null });
          return n;
        });
        goTo(to, false);
      } else focusBox();
      return;
    }
    if (!sentence || phase !== "dictating") return;
    clearAuto();
    setAdFrom(pos);
    setPhase("ad");
    player.play(sentence.startMs, null, speed);
  };
  const cancelAd = () => {
    clearAuto();
    player.stop();
    setPhase("dictating");
    focusBox();
  };

  // ---------- stopping and finishing ----------

  const showResults = useCallback(async () => {
    drafts.current.set(posRef.current, box.current?.value ?? "");
    player.stop();
    const s = secondsSince();
    addSeconds(s);
    await backend.savePosition(attemptId, posRef.current, s);
    setSummary(await backend.summary(attemptId));
    setPhase("results");
  }, [attemptId, player, secondsSince]);

  // Past the last sentence of a finished transcript: the attempt is complete.
  useEffect(() => {
    if (done && pos >= sentences.length && phase === "dictating") {
      player.stop();
      backend.finishDictation(attemptId).then((s) => {
        setSummary(s);
        setPhase("results");
      });
    }
  }, [done, pos, sentences.length, phase, attemptId, player]);

  const openStop = () => {
    clearAuto();
    player.stop();
    setPhase("stop");
  };

  const resume = () => {
    setPhase("dictating");
    setSummary(null);
    focusBox();
  };

  const practiseAgain = async () => onAgain(await backend.startDictation(item.id, true));

  // ---------- keys ----------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (phase === "results" || phase === "stop" || e.isComposing) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (modKey(e) && !e.altKey && !e.shiftKey) {
      // By character, or by key position for keyboards where these characters sit elsewhere.
      const k = e.key.toLowerCase();
      const is = (key: string, ...codes: string[]) => k === key || codes.includes(e.code);
      if (is("r", "KeyR")) slow();
      else if (is("p", "KeyP")) {
        if (phase === "dictating" && playSentence(speed, true) && plays + 1 > settings.maxPlays)
          setNote(`Played ${plays + 1} times · ${plays + 1 - settings.maxPlays} over your limit of ${settings.maxPlays}.`);
      } else if (is("arrowleft")) move(-1);
      else if (is("arrowright")) move(1);
      else if (is("arrowdown")) jump(firstNotDone());
      else if (is("d", "KeyD")) {
        if (phase === "dictating" && sentence) toggleFlag();
      }
      else if (is("k", "KeyK")) toggleAd();
      else if (is("-", "Minus", "NumpadSubtract")) setSpeed(speed - SPEED_STEP);
      else if (is("=", "Equal", "NumpadAdd") || k === "+") setSpeed(speed + SPEED_STEP);
      else if (is("0", "Digit0", "Numpad0")) setSpeed(1);
      else if (is("\\", "Backslash")) setFocus(!focus);
      else return;
      return stop();
    }
    if (e.key === "Escape") {
      stop();
      if (phase === "ad") cancelAd();
      else openStop();
      return;
    }
    if (phase !== "dictating") return;
    // The dictation keys work from the box, or with nothing else focused.
    const t = e.target as HTMLElement | null;
    if (t !== box.current && t?.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
    if (e.key === "Tab" && !e.shiftKey) {
      stop();
      playSentence();
      focusBox();
    } else if (e.key === "Tab" && e.shiftKey) {
      stop();
      submit("known");
    } else if (e.key === "Enter" && e.shiftKey) {
      stop();
      submit("typed");
    }
  };
  useEffect(() => {
    // Capture, so these win over the app-wide shortcuts (Mod K is search elsewhere).
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ---------- view ----------

  // The sentences just before this one, done or not, so it's clear where in the episode this is.
  const before = useMemo(() => {
    const list: number[] = [];
    for (let i = Math.max(0, pos - 3); i < pos; i++) list.push(i);
    return list;
  }, [pos]);
  const doneCount = [...answers.values()].filter((a) => a.kind !== "ad").length;
  const adCount = answers.size - doneCount;
  const toDo = total !== null ? total - adCount : null;
  const left = total !== null ? Math.max(0, total - pos - 1) : null;
  const playsLeft = settings.maxPlays - plays;
  const current = answers.get(pos);
  const inSentence = player.playing && sentence && phase === "dictating" ? (player.positionMs - sentence.startMs) / Math.max(1, sentence.endMs - sentence.startMs) : 0;
  const elapsed = secondsBase + Math.min(180, Math.round((Date.now() - lastSave.current) / 1000));

  const actions = (
    <>
      <span className="mono" style={{ fontSize: 12, color: "var(--ink-muted)", whiteSpace: "nowrap" }} title="Sentences done">
        {doneCount} / {toDo ?? `${sentences.length - adCount}+`} done
      </span>
      <span className="track" role="progressbar" aria-label="Sentences done" aria-valuenow={doneCount} aria-valuemax={toDo ?? undefined} style={{ width: 120 }}>
        <span className="fill" style={{ display: "block", width: `${toDo ? Math.round((doneCount / toDo) * 100) : 0}%` }} />
      </span>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Focus mode" aria-pressed={focus} onClick={() => setFocus(!focus)}>
        <Icon name="focus" size={14} />
        <Kbd keys="Mod \" />
      </button>
      {phase !== "results" && (
        <button type="button" className="btn btn-sm" onClick={() => (phase === "ad" ? cancelAd() : openStop())}>
          Stop <Kbd keys="Esc" />
        </button>
      )}
    </>
  );

  if (phase === "results" && summary) {
    return (
      <Page crumbs={crumbs} actions={actions}>
        <Review
          summary={{ ...summary, flagged: flagged.size }}
          answers={answers}
          flagged={flagged}
          sentences={sentences}
          maxPlays={settings.maxPlays}
          onFlag={(i) => toggleFlag(i)}
          onResume={summary.attempt.finishedAt ? null : resume}
          onAgain={summary.attempt.finishedAt ? practiseAgain : null}
          onBack={() => navigate(`/library/${item.id}`)}
        />
      </Page>
    );
  }

  return (
    <Page crumbs={crumbs} keys={KEYS} actions={actions}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <section aria-label="Sentences" className="page" style={{ flexGrow: 1, minWidth: 0, gap: 4, padding: "24px 40px 32px 28px" }}>
          {before.length > 0 && (
            <div className="eyebrow" style={{ paddingLeft: 42, marginBottom: 6 }}>
              Your text so far · the original shows in the review
            </div>
          )}
          {before.map((i) => {
            const a = answers.get(i);
            return (
              <div key={i} className="done-row" style={a ? undefined : { color: "var(--ink-tertiary)" }}>
                <span className="mono num">{i + 1}</span>
                <span className="ell" style={{ flexGrow: 1, ...(a?.kind === "known" ? { color: "var(--ink-tertiary)" } : {}) }}>
                  {!a ? "Not done yet" : a.kind === "ad" ? "Ad · left out" : a.kind === "known" ? "Known · not typed" : a.typed || "(nothing typed)"}
                </span>
                {flagged.has(i) && (
                  <span className="flag-label">
                    <Icon name="flag" size={12} />
                    Flagged
                  </span>
                )}
              </div>
            );
          })}

          {sentence ? (
            <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
              <span className="mono current-num">{pos + 1}</span>
              <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="eyebrow" style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: -4 }}>
                  <span style={{ color: "var(--ink)" }}>
                    Sentence {pos + 1}
                    {total ? ` of ${total}` : ""}
                  </span>
                  {current?.kind === "typed" && <span>· Done · finishing it again replaces the answer</span>}
                  {current?.kind === "known" && <span>· Done: known</span>}
                  {current?.kind === "ad" && <span>· Left out as an ad</span>}
                  {flagged.has(pos) && (
                    <span className="flag-label">
                      <Icon name="flag" size={12} />
                      Flagged for review
                    </span>
                  )}
                </div>
                {phase === "ad" ? (
                  <div className="panel" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }} role="status">
                    <span className="dot dot-ok" aria-hidden="true" />
                    <span style={{ flexGrow: 1 }}>
                      Skipping a section · playing on from sentence {adFrom + 1}, now at {adAt + 1}. Press <Kbd keys="Mod K" /> when the episode is back; the
                      sentences before that are left out of your score. <Kbd keys="Esc" /> cancels.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="panel" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 14 }}>
                      <button
                        type="button"
                        className="btn"
                        aria-label={plays ? "Play again" : "Play"}
                        onClick={() => {
                          playSentence();
                          focusBox();
                        }}
                        style={{ width: 36, height: 36, padding: 0, borderRadius: 9999, flexShrink: 0 }}
                      >
                        <Icon name={plays ? "replay" : "play"} size={15} stroke={1.8} />
                      </button>
                      <span className="track" style={{ flexGrow: 1 }} aria-hidden="true">
                        <span className="fill" style={{ display: "block", width: `${Math.min(100, Math.round(inSentence * 100))}%`, transition: "width 120ms linear" }} />
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} aria-label={`Played ${plays} of ${settings.maxPlays} times`}>
                          {Array.from({ length: settings.maxPlays }, (_, i) => (
                            <span key={i} className={i < plays ? "dot dot-ink" : "dot dot-ring"} />
                          ))}
                          <span className="mono" style={{ fontSize: 12, color: plays > settings.maxPlays ? "var(--semantic-error)" : "var(--ink)", marginLeft: 4 }}>
                            {plays} / {settings.maxPlays}
                            {plays > settings.maxPlays && ` · ${plays - settings.maxPlays} over`}
                          </span>
                        </span>
                        <span className="mono" style={{ fontSize: 11 }}>
                          {settings.mode === "auto" ? "Auto" : "Manual"} · {speedLabel(speed)}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} role="status">
                      {note ||
                        (plays === 0 ? (
                          <>
                            Press <Kbd keys="Tab" /> to play the sentence{settings.mode === "auto" ? ` ${plural(settings.maxPlays, "time")} in a row` : ""}.
                          </>
                        ) : playsLeft > 0 ? (
                          <>
                            Played {plays === 1 ? "once" : `${plays} times`} · {plural(playsLeft, "play")} left. <Kbd keys="Tab" /> plays it again.
                          </>
                        ) : (
                          <>
                            No plays left. <Kbd keys="Mod P" /> plays it anyway.
                          </>
                        ))}
                    </div>
                  </>
                )}

                <label htmlFor="dictation" className="eyebrow" style={{ marginTop: 4 }}>
                  Type what you hear
                </label>
                <textarea
                  id="dictation"
                  ref={box}
                  className="typing"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={phase !== "dictating"}
                  placeholder={current?.kind === "known" ? "Known: not typed. Type here to answer it instead." : undefined}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-primary" onClick={() => submit("typed")} disabled={busy || phase !== "dictating"}>
                    Finish sentence <Kbd keys="Shift Enter" />
                  </button>
                  <button type="button" className="btn" onClick={() => submit("known")} disabled={busy || phase !== "dictating"}>
                    I know this one <Kbd keys="Shift Tab" />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost${flagged.has(pos) ? " flag-label" : ""}`}
                    aria-pressed={flagged.has(pos)}
                    onClick={() => {
                      toggleFlag();
                      focusBox();
                    }}
                    disabled={phase !== "dictating"}
                  >
                    <Icon name="flag" size={14} />
                    {flagged.has(pos) ? "Flagged" : "Flag for review"} <Kbd keys="Mod D" />
                  </button>
                  <span style={{ flexGrow: 1 }} />
                  <button type="button" className="btn btn-ghost" onClick={toggleAd}>
                    {phase === "ad" ? "The episode is back" : "Skip section"} <Kbd keys="Mod K" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
              <span className="mono" style={{ width: 28, textAlign: "right", fontSize: 12, color: "var(--ink)", paddingTop: 14 }}>
                {pos + 1}
              </span>
              <div className="panel" style={{ flexGrow: 1, padding: 16, display: "flex", alignItems: "center", gap: 12 }} role="status">
                <span className="dot dot-ring" aria-hidden="true" />
                <span style={{ flexGrow: 1 }}>You've caught up with the transcription. The next sentences are on their way; this carries on by itself.</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(-1)}>
                  Previous sentence
                </button>
              </div>
            </div>
          )}

          {sentence && phase === "dictating" && (
            <div style={{ display: "flex", gap: 14, marginTop: 22, fontSize: 13, color: "var(--ink-tertiary)" }}>
              <span className="mono" style={{ width: 28, textAlign: "right", fontSize: 12 }}>
                {pos + 2}
              </span>
              <span>
                {left === 0 ? (
                  "This is the last sentence."
                ) : (
                  <>
                    Waits for you. Press <Kbd keys="Tab" /> after finishing this one to play it.{" "}
                    {left !== null ? `${plural(left, "sentence")} to go.` : "More sentences are being transcribed."}
                  </>
                )}
              </span>
            </div>
          )}
        </section>

        {!focus && (
          <aside className="insp" aria-label="Playback">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="eyebrow">Playback</div>
              <PlaybackSettings settings={settings} update={update} onSpeed={setSpeed} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="eyebrow">This session</div>
              <div className="cells" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div className="cell">
                  <div className="big">{doneCount}</div>
                  <div className="small">Sentences done</div>
                </div>
                <div className="cell">
                  <div className="big">{flagged.size}</div>
                  <div className="small">Flagged</div>
                </div>
                <div className="cell" style={{ gridColumn: "span 2" }}>
                  <div className="big mono">{clock(elapsed)}</div>
                  <div className="small">Time</div>
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5 }}>Settings here change this session and become your defaults.</p>
          </aside>
        )}
      </div>

      {phase === "stop" && (
        <StopDialog
          done={doneCount}
          flagged={flagged.size}
          pos={pos}
          total={total}
          onResults={showResults}
          onLater={() => navigate(`/library/${item.id}`)}
          onCancel={() => {
            setPhase("dictating");
            focusBox();
          }}
        />
      )}
    </Page>
  );
}

function StopDialog({
  done,
  flagged,
  pos,
  total,
  onResults,
  onLater,
  onCancel,
}: {
  done: number;
  flagged: number;
  pos: number;
  total: number | null;
  onResults: () => void;
  onLater: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="stop-title">
        <h2 id="stop-title" className="h2">
          Stop for now?
        </h2>
        <p style={{ lineHeight: 1.55 }}>
          You've done {plural(done, "sentence")}
          {total ? ` of ${total}` : ""}
          {flagged ? `, ${flagged} flagged for review` : ""}. Your progress is saved either way, and you can resume at sentence {pos + 1} any time.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={onResults} autoFocus>
            Review so far <Kbd keys="Enter" />
          </button>
          <button type="button" className="btn" onClick={onLater}>
            Save and continue later
          </button>
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Keep going <Kbd keys="Esc" />
          </button>
        </div>
      </div>
    </div>
  );
}
