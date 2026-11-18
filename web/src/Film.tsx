import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Strings } from "./i18n";

// The desktop app, recreated, playing out its main features. Scrolling picks the chapter; each chapter is a
// short script (typing, clicks, AI answers) while a camera zooms into the part of the window it's about.

const AW = 1200; // the app window, in its own pixels
const AH = 760;

type Screen = "dictation" | "review" | "listen" | "progress";

type State = {
  screen: Screen;
  focus: string | null; // the part of the window the camera looks at
  zoom: number;
  cursor: string | null; // where the pointer is
  click: number; // bumps on each click
  typed: number; // characters typed in dictation
  key: string | null; // keycap being pressed
  marks: boolean; // review marks shown
  ask: boolean; // the Ask panel open
  asked: boolean; // the question sent
  why: number; // characters of the AI's answer shown
  shown: boolean; // listen: the sentence shown
  selected: boolean; // listen: "fade" selected
  card: boolean; // listen: the dictionary card open
  explain: number; // characters of the explanation shown
  bars: boolean; // progress: bars grown
};

const START: State = {
  screen: "dictation", focus: null, zoom: 1, cursor: null, click: 0, typed: 0, key: null, marks: false,
  ask: false, asked: false, why: 0, shown: false, selected: false, card: false, explain: 0, bars: false,
};

const TYPED = "Most people wait for motivation but it usual comes";

type Step = [number, Partial<State> | ((s: State) => Partial<State>)];

/** Steps that reveal `n` characters of something, one every `ms`, starting at `at`. */
function stream(at: number, n: number, ms: number, key: "typed" | "why" | "explain"): Step[] {
  return Array.from({ length: n }, (_, i) => [at + i * ms, { [key]: i + 1 }] as Step);
}

const click = (s: State) => ({ click: s.click + 1 });

/** Each chapter: the state it starts from, and its script (milliseconds from the start). */
function chapters(t: Strings): { start: Partial<State>; steps: Step[] }[] {
  const whyLen = t.whyUsually.length + t.whyLater.length;
  return [
    {
      start: { screen: "dictation" },
      steps: [
        [700, { focus: "input", zoom: 1.9 }],
        ...stream(1500, TYPED.length, 55, "typed"),
        [1600 + TYPED.length * 55, { key: "finish" }],
        [2000 + TYPED.length * 55, { key: null, focus: null, zoom: 1 }],
      ],
    },
    {
      start: { screen: "review", typed: TYPED.length },
      steps: [
        [400, { focus: "row", zoom: 1.65 }],
        [1300, { marks: true }],
      ],
    },
    {
      start: { screen: "review", typed: TYPED.length, marks: true, focus: "row", zoom: 1.65 },
      steps: [
        [300, { cursor: "askLink" }],
        [1100, click],
        [1200, { ask: true, focus: "ask", zoom: 1.5 }],
        [2100, { cursor: "chip" }],
        [2800, click],
        [2900, { asked: true, cursor: null }],
        ...stream(3500, whyLen, 18, "why"),
      ],
    },
    {
      start: { screen: "listen" },
      steps: [
        [500, { focus: "sentences", zoom: 1.5 }],
        [1100, { shown: true }],
        [1800, { cursor: "fade" }],
        [2600, click],
        [2650, { selected: true }],
        [3000, { card: true, focus: "card", zoom: 1.7, cursor: null }],
      ],
    },
    {
      start: { screen: "listen", shown: true, selected: true, card: true, focus: "card", zoom: 1.7 },
      steps: [
        [300, { cursor: "explainBtn" }],
        [1100, click],
        [1200, { cursor: null }],
        ...stream(1800, t.explain.length, 22, "explain"),
      ],
    },
    {
      // Straight to the panel in one camera move, so nothing waits on screen first.
      start: { screen: "progress", focus: "mishear", zoom: 1.35 },
      steps: [
        [300, { bars: true }],
        [2600, { bars: true }],
      ],
    },
  ];
}

const motionOk = () => matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** Runs the chapter's script on a pausable clock; with reduced motion, jumps to its end. */
/** How long each chapter's last state stays on screen before the next chapter. */
const HOLD = 2200;

/**
 * Runs the chapter's script on a clock that stops while paused or off screen, then calls `onEnd`.
 * With reduced motion, shows the chapter's end state and doesn't move on by itself.
 */
function useScript(t: Strings, chapter: number, paused: boolean, visible: boolean, onEnd: () => void): State {
  const [state, setState] = useState<State>(START);
  const clock = useRef(0);
  const { start, steps } = chapters(t)[chapter];
  const end = Math.max(...steps.map(([at]) => at)) + HOLD;
  const done = useRef(onEnd);
  done.current = onEnd;

  useEffect(() => {
    clock.current = 0;
    const base = { ...START, ...start };
    if (!motionOk()) {
      setState(steps.reduce<State>((s, [, p]) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }), base));
      return;
    }
    setState(base);
  }, [chapter, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || !visible || !motionOk()) return;
    const id = setInterval(() => {
      const from = clock.current;
      const to = from + 50;
      clock.current = to;
      const due = steps.filter(([at]) => at > from && at <= to);
      if (due.length) setState((s) => due.reduce<State>((x, [, p]) => ({ ...x, ...(typeof p === "function" ? p(x) : p) }), s));
      if (from < end && to >= end) done.current();
    }, 50);
    return () => clearInterval(id);
  }, [chapter, paused, t, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

/** Where `el` sits inside `root`, in the window's own pixels (transforms ignored). */
function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function Story({ t, captions, paused, control }: { t: Strings; captions: string[]; paused: boolean; control: ReactNode }) {
  const [chapter, setChapter] = useState(0);

  // The film plays while the window is well in view, and waits where it was when scrolled away.
  const stage = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] });
    io.observe(stage.current!);
    return () => io.disconnect();
  }, []);

  // One film: each chapter leads into the next, and the last back to the first.
  const state = useScript(t, chapter, paused, visible, () => setChapter((c) => (c + 1) % captions.length));
  const ms = Math.max(...chapters(t)[chapter].steps.map(([at]) => at)) + HOLD;

  return (
    <section className="story" aria-label="Eksigo">
      <div className="story-head wrap">
        <h2 className="story-caption" key={chapter} aria-live="polite">
          {captions[chapter]}
        </h2>
      </div>
      <div className="story-stage wrap" ref={stage}>
        <div className="cam-wrap">
          <Camera state={state}>
            <AppWindow state={state} t={t} />
          </Camera>
          {control}
        </div>
      </div>
      <div className="story-chapters wrap">
        {captions.map((c, i) => (
          <button key={i} type="button" className="story-chapter" aria-current={i === chapter || undefined} onClick={() => setChapter(i)}>
            <span className="story-bar">{i === chapter && <i key={chapter} style={{ animationDuration: `${ms}ms`, animationPlayState: paused || !visible ? "paused" : "running" }} />}</span>
            <span className="story-label">{c}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Camera({ state, children }: { state: State; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState("");

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = app.current;
    if (!root || !size.w) return;
    const fit = Math.min(size.w / AW, size.h / AH);
    const target = state.focus ? (root.querySelector(`[data-f="${state.focus}"]`) as HTMLElement | null) : null;
    let s = fit;
    let cx = AW / 2;
    let cy = AH / 2;
    if (target) {
      const r = offsetIn(target, root);
      cx = r.x + r.w / 2;
      cy = r.y + r.h / 2;
      // Zoom in up to `state.zoom`, but never so far that the part looked at is cut off.
      s = fit * Math.max(1, Math.min(state.zoom, (size.w * 0.94) / (r.w * fit), (size.h * 0.9) / (r.h * fit)));
    }
    const clamp = (v: number, view: number, full: number) => (full <= view ? (view - full) / 2 : Math.min(0, Math.max(view - full, v)));
    const tx = clamp(size.w / 2 - cx * s, size.w, AW * s);
    const ty = clamp(size.h / 2 - cy * s, size.h, AH * s);
    setTransform(`translate(${tx}px, ${ty}px) scale(${s})`);
  }, [state, size]);

  return (
    <div className="camera" ref={box}>
      <div className="camera-app" ref={app} style={{ width: AW, height: AH, transform }}>
        {children}
        <Cursor root={app} state={state} />
      </div>
    </div>
  );
}

function Cursor({ root, state }: { root: React.RefObject<HTMLDivElement | null>; state: State }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const r = root.current;
    const el = state.cursor && r ? (r.querySelector(`[data-c="${state.cursor}"]`) as HTMLElement | null) : null;
    if (!el || !r) return setPos(null);
    const o = offsetIn(el, r);
    setPos({ x: o.x + o.w * 0.55, y: o.y + o.h * 0.6 });
  }, [state.cursor, state.screen, state.ask, state.card, root]);
  return (
    <div className="cursor" data-on={!!pos || undefined} style={{ transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : "translate(900px, 700px)" }}>
      <span className="cursor-ring" key={state.click} />
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.5L10 19z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" /></svg>
    </div>
  );
}

// ——— The app window ———

function Kbd({ children, on }: { children: ReactNode; on?: boolean }) {
  return <span className={on ? "a-kbd on" : "a-kbd"}>{children}</span>;
}

function AppWindow({ state, t }: { state: State; t: Strings }) {
  const crumbs: Record<Screen, string[]> = {
    dictation: ["Library", "The Morning Walk", "Why small habits beat big plans"],
    review: ["Library", "The Morning Walk", "Review"],
    listen: ["Library", "The Morning Walk", "Why small habits beat big plans", "Listen"],
    progress: ["Progress"],
  };
  const nav = state.screen === "progress" ? "Progress" : "Library";
  return (
    <div className="app">
      <aside className="a-side">
        <div className="a-lights" aria-hidden="true"><i /><i /><i /></div>
        <div className="a-brand">Eksigo</div>
        <div className="a-search">Search <Kbd>⌘ K</Kbd></div>
        {["Today", "Podcasts", "Library", "My words", "Progress"].map((n) => (
          <div key={n} className={n === nav ? "a-nav on" : "a-nav"}>{n}</div>
        ))}
        <div className="a-group">In progress</div>
        <div className="a-nav small">Why small habits… <span className="a-mono">34/120</span></div>
        <span className="grow" />
        <div className="a-nav">Settings</div>
      </aside>
      <div className="a-main">
        <div className="a-top">
          {crumbs[state.screen].map((c, i, all) => (
            <span key={i} className={i === all.length - 1 ? "a-crumb last" : "a-crumb"}>
              {i > 0 && <span className="a-sep">/</span>}
              {c}
            </span>
          ))}
          <span className="grow" />
          {state.screen === "dictation" && (
            <>
              <span className="a-mono">{state.key === "finish" ? 34 : 33} / 120 done</span>
              <span className="a-meter"><i style={{ width: "28%" }} /></span>
              <span className="a-btn">Stop <Kbd>Esc</Kbd></span>
            </>
          )}
          {state.screen === "listen" && <span className="a-btn">Dictate instead</span>}
        </div>
        <div className="a-body" key={state.screen}>
          {state.screen === "dictation" && <Dictation state={state} />}
          {state.screen === "review" && <Review state={state} t={t} />}
          {state.screen === "listen" && <Listen state={state} t={t} />}
          {state.screen === "progress" && <Progress state={state} />}
        </div>
      </div>
      <div className="a-status">
        <span>Transcript ready</span>
        <span className="grow" />
        <Kbd>Tab</Kbd> Play <Kbd>⇧ ↵</Kbd> Finish <Kbd>⇧ Tab</Kbd> Know it <Kbd>Esc</Kbd> Stop
        <span className="a-mono">v0.1.1</span>
      </div>
    </div>
  );
}

function Dictation({ state }: { state: State }) {
  return (
    <div className="a-cols">
      <div className="a-center">
        <div className="a-prev"><span className="a-n">33</span>And most of us have watched that plan fade within a week.</div>
        <div className="a-sent">
          <span className="a-n strong">34</span>
          <div className="a-stack">
            <div className="a-label">Sentence 34 of 120</div>
            <div className="a-player">
              <span className={state.typed > 0 ? "a-play" : "a-play playing"} />
              <span className="a-track"><i style={{ width: state.typed > 0 ? "100%" : "45%" }} /></span>
              <span className="a-mono">●○○ 1 / 3</span>
            </div>
            <div className="a-label">Type what you hear</div>
            <div className="a-input" data-f="input">
              {TYPED.slice(0, state.typed)}
              <span className="a-caret" />
            </div>
            <div className="a-row">
              <span className={state.key === "finish" ? "a-btn primary pressed" : "a-btn primary"}>Finish sentence <Kbd on={state.key === "finish"}>⇧ ↵</Kbd></span>
              <span className="a-btn">I know this one <Kbd>⇧ Tab</Kbd></span>
              <span className="grow" />
              <span className="a-ghost">Flag for review <Kbd>⌘ D</Kbd></span>
            </div>
          </div>
        </div>
        <div className="a-next"><span className="a-n">35</span>Waits for you. Press <Kbd>Tab</Kbd> after finishing this one to play it.</div>
      </div>
      <aside className="a-panel">
        <div className="a-h">Playback</div>
        <div className="a-kv"><span>Mode</span><span className="a-seg"><b>Manual</b><i>Auto</i></span></div>
        <div className="a-kv"><span>Speed</span><span className="a-slider"><i /></span><span className="a-mono">1.0×</span></div>
        <div className="a-kv"><span>Max plays</span><span className="a-mono">3</span></div>
        <div className="a-h" style={{ marginTop: 18 }}>This session</div>
        <div className="a-tiles">
          <div><b>{state.key === "finish" ? 34 : 33}</b><span>Sentences done</span></div>
          <div><b>1</b><span>Flagged</span></div>
          <div><b>18:40</b><span>Time</span></div>
        </div>
      </aside>
    </div>
  );
}

const SAID: [string, "" | "miss"][] = [
  ["Most", ""], ["people", ""], ["wait", ""], ["for", ""], ["motivation,", ""], ["but", ""], ["it", ""], ["usually", "miss"], ["comes", ""], ["later.", "miss"],
];

function Review({ state, t }: { state: State; t: Strings }) {
  const answer = (t.whyUsually + t.whyLater).slice(0, state.why);
  const a1 = answer.slice(0, t.whyUsually.length);
  const a2 = answer.slice(t.whyUsually.length);
  return (
    <div className="a-review">
      <div className="a-titlebar"><span className="a-title">Review</span><span className="grow" /><span className="a-btn primary">Resume at sentence 35</span></div>
      <div className="a-stats">
        {[["86%", "Accuracy"], ["34 / 120", "Sentences done"], ["3", "Known"], ["1", "Flagged"], ["18:40", "Time"]].map(([v, l]) => (
          <div key={l}><b>{v}</b><span>{l}</span></div>
        ))}
      </div>
      <div className="a-table">
        <div className="a-thead"><span /><span>Original</span><span>You typed</span><span /></div>
        <div className="a-tr">
          <span className="a-n">33</span>
          <span>And most of us have watched that plan fade within a week.</span>
          <span className="muted">And most of us have watched that plan fade within a week</span>
          <span className="a-mono">100%</span>
        </div>
        <div className="a-tr" data-f="row">
          <span className="a-n">34</span>
          <span>
            {SAID.map(([w, k], i) => (
              <span key={i}><span className={state.marks && k ? "a-miss" : undefined}>{w}</span> </span>
            ))}
          </span>
          <span>
            <span>Most people wait for motivation but it </span>
            <span className={state.marks ? "a-wrong" : undefined}>usual</span>
            <span> comes</span>
            <span className="a-asklink" data-c="askLink">Ask about this sentence</span>
          </span>
          <span className="a-mono">{state.marks ? "80%" : ""}</span>
        </div>
        {state.ask && (
          <div className="a-ask" data-f="ask">
            <div className="a-askhead"><b>Ask about this sentence</b><span className="a-source"><i />ChatGPT plan</span></div>
            {state.asked && (
              <div className="a-thread">
                <div className="a-me">Why did I miss this?</div>
                <div className="a-reason"><span className="a-miss">usually</span> → <span className="a-wrong">usual</span><p>{a1}<span className={a2 ? "" : "a-caret"} /></p></div>
                {a2 && <div className="a-reason"><span className="a-miss">later</span><p>{a2}<span className={state.why < t.whyUsually.length + t.whyLater.length ? "a-caret" : ""} /></p></div>}
              </div>
            )}
            <div className="a-chips">
              {!state.asked && <span className="a-chip" data-c="chip">Why did I miss this?</span>}
              <span className="a-chip">What does it mean?</span>
              <span className="a-chip">Explain the grammar</span>
              <span className="a-field">Ask a follow-up…</span>
            </div>
          </div>
        )}
        <div className="a-tr">
          <span className="a-n">35</span>
          <span>The trick is that you don’t have to feel ready.</span>
          <span className="muted">The trick is that you don’t have to feel ready</span>
          <span className="a-mono">100%</span>
        </div>
      </div>
    </div>
  );
}

const LINES = [
  "Most people wait for motivation, but it usually comes later.",
  "And most of us have watched that plan fade within a week.",
  "The trick is that you don’t have to feel ready.",
  "You just start before the feeling arrives.",
];

function Listen({ state, t }: { state: State; t: Strings }) {
  return (
    <div className="a-cols">
      <div className="a-center">
        <div className="a-lplayer">
          <span className="a-play playing" />
          <span className="a-mono">4:12 / 13:11</span>
          <span className="a-track"><i style={{ width: "32%" }} /></span>
          <span className="a-seg"><i>0.85×</i><b>1.0×</b><i>1.25×</i></span>
        </div>
        <div className="a-row" style={{ margin: "16px 0 10px" }}>
          <span className="a-label" style={{ margin: 0 }}>Sentences</span>
          <span className="muted" style={{ fontSize: 12 }}>Select words to look them up.</span>
          <span className="grow" />
          <span className="a-seg"><b>Hidden</b><i>All shown</i></span>
        </div>
        <div className="a-lines" data-f="sentences">
          {LINES.map((line, i) => {
            const now = i === 1;
            const shown = i === 0 || (now && state.shown);
            return (
              <div key={i} className={now ? "a-line now" : "a-line"}>
                <span className="a-n">{i + 33}</span>
                {shown ? (
                  <span className="a-words">
                    {line.split(" ").map((w, j) => (
                      <span key={j}>
                        <span className={w === "fade" && state.selected ? "a-sel" : undefined} data-c={w === "fade" ? "fade" : undefined}>{w}</span>{" "}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="a-bars">
                    {line.split(" ").map((w, j) => (
                      <i key={j} style={{ width: w.length * 7.5 }} data-heard={(now && j < 6) || undefined} />
                    ))}
                  </span>
                )}
                {now && <span className="a-show">{state.shown ? "Hide" : "Show"} <Kbd>S</Kbd></span>}
              </div>
            );
          })}
        </div>
      </div>
      <aside className="a-panel">
        {state.card ? (
          <div className="a-card" data-f="card">
            <div className="a-word">fade <span className="a-mono muted">/feɪd/</span></div>
            <div className="a-row" style={{ gap: 6 }}>
              <span className="a-btn sm">▷ As said in the episode</span>
              <span className="a-ghost">Slow voice</span>
            </div>
            <div className="a-def"><span className="a-pos">v.</span> to slowly become less bright, strong or clear</div>
            {t.meaning !== "to slowly disappear" && <div className="a-mean">{t.meaning}</div>}
            <span className="a-btn primary sm" style={{ alignSelf: "flex-start" }}>+ Add to My words <Kbd>A</Kbd></span>
            {state.explain > 0 ? (
              <div className="a-explain" data-f="explain">
                <div className="a-label" style={{ margin: 0 }}>In this sentence</div>
                <p>
                  {t.explain.slice(0, state.explain)}
                  {state.explain < t.explain.length && <span className="a-caret" />}
                </p>
                <span className="a-source"><i />ChatGPT plan</span>
              </div>
            ) : (
              <span className="a-btn sm" data-c="explainBtn" data-f="explain" style={{ alignSelf: "flex-start" }}>Explain in this sentence</span>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Show a sentence, then select a word or phrase in it to see its meaning and save it to My words.
          </p>
        )}
      </aside>
    </div>
  );
}

const KINDS: [string, number, string[]][] = [
  ["Small words", 41, ["to", "of", "the", "it's"]],
  ["Linked sounds", 29, ["kind of", "going to", "want to"]],
  ["Endings", 18, ["walked", "usually", "plans"]],
  ["Numbers", 9, ["fifteen", "1960"]],
  ["Names", 6, ["Georgie", "BBC"]],
];

function Progress({ state }: { state: State }) {
  return (
    <div className="a-review">
      <div className="a-titlebar"><span className="a-title">Progress</span></div>
      <div className="a-mishear" data-f="mishear">
        <div className="a-row" style={{ marginBottom: 14 }}>
          <b style={{ color: "var(--ink)", fontSize: 15 }}>What you mishear most</b>
          <span className="grow" />
          <span className="muted a-mono" style={{ fontSize: 12 }}>last 90 days · 312 sentences</span>
        </div>
        {KINDS.map(([name, n, ex], i) => (
          <div className="a-kind" key={name}>
            <span>{name}</span>
            <span className="a-ktrack"><i style={{ width: `${(n / 41) * 100}%`, transform: state.bars ? "scaleX(1)" : "scaleX(0)", transitionDelay: `${i * 90}ms` }} /></span>
            <span className="a-mono">{n}</span>
            <span className="a-ex">{ex.map((e) => <span key={e} className="a-chip sm">{e}</span>)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
