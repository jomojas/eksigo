// Stand-ins for the Rust core in a plain browser (`npm run dev`, the preview pane): a few shows, episodes
// and Library items kept in memory, with downloads and playback simulated by timers. Never used in the app.

import type {
  GradeArgs,
  Graded,
  Level,
  PracticeCounts,
  NewEpisode,
  Week,
  Progress,
  DayDetail,
  PracticeItem,
  DictInfo,
  DictionaryList,
  StorageUsage,
  Added,
  Answer,
  AnswerKind,
  Lookup,
  NewWord,
  SavedWord,
  Attempt,
  Comparison,
  EpisodePage,
  Episode,
  InProgress,
  Item,
  LibraryPage,
  Listing,
  Marked,
  ModelInfo,
  PlaybackEvent,
  Practice,
  Sentence,
  Session,
  Show,
  ShowPage,
  Summary,
  TranscriptStatus,
} from "./backend";
import learnersJson from "../../src-tauri/data/learners.json";

type Learner = { appleId: string; title: string; author: string; feedUrl: string; artworkUrl: string; blurb: string };

const learners: Listing[] = (learnersJson as Learner[]).map((l) => ({
  appleId: l.appleId,
  title: l.title,
  author: l.author,
  feedUrl: l.feedUrl,
  artworkUrl: l.artworkUrl,
  note: l.blurb,
}));

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

const shows: Show[] = [];
const episodes: Episode[] = [];
const items: Item[] = [];

function makeShow(l: Listing, subscribed: boolean): Show {
  const show: Show = {
    id: shows.length + 1,
    feedUrl: l.feedUrl ?? `https://example.com/${shows.length + 1}.rss`,
    appleId: l.appleId,
    title: l.title,
    author: l.author,
    description: l.note ?? "",
    artworkUrl: l.artworkUrl,
    subscribed,
    refreshedAt: now(),
    episodeCount: 0,
    newCount: subscribed ? 1 : 0,
  };
  shows.push(show);
  const titles = [
    "Why mornings feel shorter in winter",
    "Why small habits beat big plans",
    "The case for doing one thing at a time",
    "What a walk does to your thinking",
    "Sleep, coffee and the afternoon dip",
    "Saying no without feeling bad",
    "The two-minute rule, tested",
    "How octopuses taste with their arms",
  ];
  titles.forEach((title, i) =>
    episodes.push({
      id: episodes.length + 1,
      showId: show.id,
      title,
      publishedAt: now() - i * 7 * DAY - DAY,
      durationS: 360 + ((i * 431) % 1400),
      audioUrl: `https://example.com/${show.id}-${i}.mp3`,
      audioBytes: 6_000_000 + i * 1_000_000,
      description:
        "Most of us have tried to change a habit and watched the plan fade within a week. This episode looks at why tiny, boring steps work better than ambitious plans, and how to start before you feel ready.",
      artworkUrl: null,
      itemId: null,
      itemState: null,
    }),
  );
  show.episodeCount = titles.length;
  return show;
}

makeShow(learners[0], true);
makeShow(learners[2], true);
makeShow(learners[3], true);

function addItem(ep: Episode, state: Item["state"], lastPractisedDaysAgo: number | null): Item {
  const show = shows.find((s) => s.id === ep.showId)!;
  const item: Item = {
    id: items.length + 1,
    episodeId: ep.id,
    showId: show.id,
    title: ep.title,
    source: show.title,
    ownFile: false,
    path: `/sample/${ep.id}.mp3`,
    bytes: ep.audioBytes,
    durationS: ep.durationS,
    state,
    error: null,
    addedAt: now() - 3 * DAY,
    lastPractisedAt: lastPractisedDaysAgo === null ? null : now() - lastPractisedDaysAgo * DAY,
    artworkUrl: show.artworkUrl,
    transcriptState: "none",
    transcriptDoneMs: 0,
  };
  items.push(item);
  ep.itemId = item.id;
  ep.itemState = state;
  return item;
}

addItem(episodes[1], "ready", 1);
addItem(episodes[9], "ready", 3);
addItem(episodes[17], "ready", null);
items.push({
  id: items.length + 1,
  episodeId: null,
  showId: null,
  title: "IELTS listening test 4.mp3",
  source: "My files",
  ownFile: true,
  path: "/Users/you/Music/IELTS listening test 4.mp3",
  bytes: 28_000_000,
  durationS: 1800,
  state: "ready",
  error: null,
  addedAt: now() - DAY,
  lastPractisedAt: now() - 3600,
  artworkUrl: null,
  transcriptState: "none",
  transcriptDoneMs: 0,
});

// ---------- transcripts ----------

const SAMPLE_TEXT = [
  "Hello, welcome to 6 Minute English from BBC Learning English.",
  "I'm Phil. And I'm Georgie.",
  "When was the last time you had a vaccination, and what was it for?",
  "Many of us get vaccinations when we are children or when we go travelling.",
  "But did you know that scientists have been developing vaccines that can be personalised?",
  "They help your body keep itself clear of some specific cancer types.",
  "Tom says that the development of the cancer vaccine has been a long time coming.",
  "This means that it's taken a lot of time to achieve.",
  "Tom also says there have been some false dawns.",
  "An expression meaning that something looks like it's improving when it's actually not.",
];

const transcripts = new Map<number, { state: TranscriptStatus["state"]; sentences: Sentence[]; doneMs: number }>();
let modelInstalled = false;

function makeSentences(durationMs: number, upToMs: number): Sentence[] {
  const out: Sentence[] = [];
  let t = 500;
  for (let i = 0; t < upToMs && t < durationMs; i++) {
    const text = SAMPLE_TEXT[i % SAMPLE_TEXT.length];
    const len = 1500 + text.length * 55;
    out.push({ idx: i, startMs: t, endMs: t + len, text });
    t += len + 200;
  }
  return out;
}

// ---------- events ----------

const listeners = new Map<string, Set<(p: unknown) => void>>();
function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

const timers = new Map<number, number>();
let playTimer: number | null = null;

const notFound = (what: string) => new Error(`That ${what} isn't in the sample data.`);

// ---------- dictation ----------

const attempts: Attempt[] = [];
const answers = new Map<number, Map<number, Answer>>();
const flags = new Map<number, Set<number>>();
// A few saved words, so My words and practice have something to show in a browser. Their episode isn't
// in the sample Library, so practice reads them with the computer's voice.
const SEED_WORDS: [string, string, number][] = [
  ["false dawns", "虚假的希望；空欢喜", 8],
  ["a long time coming", "姗姗来迟；酝酿已久", 6],
  ["personalised", "个性化的；为个人定制的", 4],
  ["vaccination", "接种疫苗", 2],
  ["keep itself clear of", "使自身远离", 5],
  ["achieve", "达到；实现", 7],
  ["specific", "特定的；具体的", 5],
  ["travelling", "旅行", 3],
];
const savedWords: SavedWord[] = SEED_WORDS.map(([text, meaning, idx], i) => {
  const sentence = SAMPLE_TEXT[idx];
  return {
    id: i + 1,
    text,
    headword: "",
    ipa: "",
    meaning,
    note: "",
    addedAt: Math.floor(Date.now() / 1000) - (8 - i) * 86_400,
    level: (i < 2 ? "learning" : "new") as Level,
    dueAt: i < 2 ? Math.floor(Date.now() / 1000) - 3600 : null,
    reviews: i < 2 ? 2 : 0,
    contexts: [
      {
        itemId: null,
        itemTitle: "6 Minute English",
        path: null,
        idx,
        sentence,
        typed: "",
        startMs: 0,
        endMs: 0,
        sentenceStartMs: 0,
        sentenceEndMs: 0,
        addedAt: Math.floor(Date.now() / 1000) - (8 - i) * 86_400,
      },
    ],
  };
});
const NEXT: [number, number, number, number] = [86_400, 2 * 86_400, 4 * 86_400, 10 * 86_400];
const looseWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
const SAMPLE_FORMS: Record<string, string> = { followed: "follow", arrives: "arrive", habits: "habit", talking: "talk" };
const SAMPLE_DICT: Record<string, [string, string, string]> = {
  "follow through": ["", "坚持到底", ""],
  "talk about": ["/tɔ:k əˈbaut/", "讨论, 谈论; 考虑（做…）", ""],
  follow: ["/ˈfɒləʊ/", "v. 跟随, 接着, 遵循", "to travel behind, go after, come after"],
  arrive: ["/əˈraɪv/", "vi. 到达, 抵达", "reach a destination"],
  habit: ["/ˈhæbɪt/", "n. 习惯, 习性", "an established custom"],
  welcome: ["/ˈwelkəm/", "n. 欢迎\nv. 欢迎\na. 受欢迎的", "the state of being welcome"],
  minute: ["/ˈmɪnɪt/", "n. 分钟, 片刻", "a unit of time equal to 60 seconds"],
  english: ["/ˈɪŋɡlɪʃ/", "n. 英语", "an Indo-European language"],
  learning: ["/ˈlɜːnɪŋ/", "n. 学习, 学问", "the cognitive process of acquiring skill or knowledge"],
  hello: ["/həˈləʊ/", "int. 你好", "an expression of greeting"],
  to: ["/tuː/", "prep. 到, 向", ""],
  from: ["/frɒm/", "prep. 从, 来自", ""],
  talk: ["/tɔːk/", "v. 说话, 谈论", "exchange thoughts; talk with"],
};
const flaggedOf = (attemptId: number) => [...(flags.get(attemptId) ?? [])].sort((x, y) => x - y);

/** A rough stand-in for compare.rs: exact words only, lined up by longest common subsequence. */
function roughCompare(original: string, typed: string): Comparison {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
  const o = original.split(/\s+/).filter(Boolean);
  const t = typed.split(/\s+/).filter(Boolean);
  const L = Array.from({ length: o.length + 1 }, () => new Array<number>(t.length + 1).fill(0));
  for (let i = o.length - 1; i >= 0; i--)
    for (let j = t.length - 1; j >= 0; j--) L[i][j] = norm(o[i]) === norm(t[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const om: Marked[] = o.map((text) => ({ text, mark: "missing" }));
  const tm: Marked[] = t.map((text) => ({ text, mark: text === "_" ? "gap" : "extra" }));
  for (let i = 0, j = 0; i < o.length && j < t.length; ) {
    if (norm(o[i]) === norm(t[j])) {
      om[i].mark = tm[j].mark = "correct";
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const credit = om.filter((m) => m.mark === "correct").length;
  return { original: om, typed: tm, credit, total: o.length, spelling: 0 };
}

function summaryOf(a: Attempt): Summary {
  const list = [...(answers.get(a.id)?.values() ?? [])];
  const scored = list.filter((x) => x.kind !== "ad");
  const credit = scored.reduce((n, x) => n + x.credit, 0);
  const total = scored.reduce((n, x) => n + x.total, 0);
  const t = transcripts.get(a.itemId);
  return {
    attempt: { ...a },
    done: scored.length,
    known: list.filter((x) => x.kind === "known").length,
    withMistakes: list.filter((x) => x.kind === "typed" && x.credit < x.total).length,
    ads: list.length - scored.length,
    flagged: flags.get(a.id)?.size ?? 0,
    credit,
    total,
    spelling: 0,
    accuracy: total ? credit / total : null,
    sentences: t?.sentences.length ?? 0,
    transcriptDone: t?.state === "done",
  };
}

function practiceOf(itemId: number | null): Practice | null {
  const mine = attempts.filter((x) => x.itemId === itemId);
  const a = mine[mine.length - 1];
  if (!a) return null;
  const s = summaryOf(a);
  return { attemptId: a.id, position: a.position, done: s.done, sentences: s.sentences, transcriptDone: s.transcriptDone, finished: a.finishedAt !== null, accuracy: s.accuracy };
}

function attemptById(id: number): Attempt {
  const a = attempts.find((x) => x.id === id);
  if (!a) throw notFound("dictation");
  return a;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SAMPLE_DICTS: DictInfo[] = [
  ["zh", "ECDICT", 5265439],
  ["ja", "EJDict", 1534012],
  ["ko", "Wiktionary", 362855],
  ["es", "Wiktionary", 768685],
  ["fr", "Wiktionary", 689289],
  ["en", "ECDICT", 1731307],
].map(([lang, source, bytes]) => ({
  lang: lang as string,
  source: source as string,
  downloadBytes: bytes as number,
  latestVersion: 1,
  installedVersion: null,
  installedBytes: 0,
}));
const installedDicts = new Map<string, Partial<DictInfo>>([
  ["zh", { installedVersion: 1, installedBytes: 16_400_000 }],
  ["en", { installedVersion: 0, installedBytes: 5_100_000 }],
]);

export const sample = {
  learners,

  search(term: string): Listing[] {
    const t = term.toLowerCase();
    return learners.filter((l) => l.title.toLowerCase().includes(t) || l.author.toLowerCase().includes(t) || t.length < 3);
  },

  chart(genre: number | null): Listing[] {
    return learners
      .slice()
      .reverse()
      .map((l) => ({ ...l, feedUrl: null, note: genre ? "Education" : "Language Learning" }));
  },

  openListing(l: Listing): number {
    return (shows.find((s) => s.appleId === l.appleId || s.title === l.title) ?? makeShow(l, false)).id;
  },

  addFeed(url: string): number {
    if (!/^https?:\/\//.test(url)) throw new Error("A feed link starts with http:// or https://");
    return makeShow({ appleId: null, title: "A show from a feed link", author: "", feedUrl: url, artworkUrl: null, note: null }, false).id;
  },

  showPage(id: number): ShowPage {
    const show = shows.find((s) => s.id === id);
    if (!show) throw notFound("show");
    return { show: { ...show }, episodes: episodes.filter((e) => e.showId === id).map((e) => ({ ...e, artworkUrl: e.artworkUrl ?? show.artworkUrl, practice: practiceOf(e.itemId) })) };
  },

  subscribe(id: number, on: boolean) {
    const show = shows.find((s) => s.id === id);
    if (show) show.subscribed = on;
  },

  newEpisodes: (): NewEpisode[] =>
    shows
      .filter((s) => s.subscribed)
      .flatMap((s) => {
        const started = (e: Episode) => attempts.some((a) => a.itemId === e.itemId);
        const e = episodes.filter((e) => e.showId === s.id && !started(e)).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))[0];
        return e ? [{ ...e, artworkUrl: e.artworkUrl ?? s.artworkUrl, showTitle: s.title }] : [];
      })
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, 3),
  subscribed: (): Show[] => shows.filter((s) => s.subscribed).map((s) => ({ ...s })),

  episodePage(id: number): EpisodePage {
    const episode = episodes.find((e) => e.id === id);
    if (!episode) throw notFound("episode");
    const show = shows.find((s) => s.id === episode.showId)!;
    const item = items.find((i) => i.id === episode.itemId) ?? null;
    return {
      episode: { ...episode, artworkUrl: episode.artworkUrl ?? show.artworkUrl, practice: practiceOf(episode.itemId) },
      show: { ...show },
      item: item && { ...item, practice: practiceOf(item.id) },
    };
  },

  download(episodeId: number): number {
    const ep = episodes.find((e) => e.id === episodeId);
    if (!ep) throw notFound("episode");
    if (ep.itemId && ep.itemState !== "failed") return ep.itemId;
    const item = addItem(ep, "downloading", null);
    item.addedAt = now();
    const total = ep.audioBytes ?? 8_000_000;
    let received = 0;
    emit("library", null);
    timers.set(
      item.id,
      window.setInterval(() => {
        received = Math.min(total, received + total / 15);
        emit("download", { itemId: item.id, received, total });
        if (received >= total) {
          window.clearInterval(timers.get(item.id));
          timers.delete(item.id);
          item.state = "ready";
          ep.itemState = "ready";
          emit("library", null);
        }
      }, 200),
    );
    return item.id;
  },

  cancel(itemId: number): boolean {
    const t = timers.get(itemId);
    if (t === undefined) return false;
    window.clearInterval(t);
    timers.delete(itemId);
    sample.remove(itemId);
    return true;
  },

  library: (): LibraryPage => ({
    items: items
      .slice()
      .sort((a, b) => (b.lastPractisedAt ?? b.addedAt) - (a.lastPractisedAt ?? a.addedAt))
      .map((i) => ({ ...i, practice: practiceOf(i.id) })),
    downloadsBytes: items.filter((i) => !i.ownFile && i.state === "ready").reduce((n, i) => n + (i.bytes ?? 0), 0),
  }),

  item(id: number): Item {
    const item = items.find((i) => i.id === id);
    if (!item) throw notFound("item");
    return { ...item, practice: practiceOf(item.id) };
  },

  addFiles: (): Added => ({ ids: [], skipped: [] }),

  remove(id: number) {
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return;
    const [item] = items.splice(at, 1);
    const ep = episodes.find((e) => e.id === item.episodeId);
    if (ep) {
      ep.itemId = null;
      ep.itemState = null;
    }
    emit("library", null);
  },

  models: (): ModelInfo[] => [
    { id: "base.en", name: "Fast", bytes: 147_964_211, installed: modelInstalled, available: true, path: "(browser preview)/models/ggml-base.en.bin" },
    { id: "small.en", name: "Accurate", bytes: 487_614_201, installed: false, available: false, path: "(browser preview)/models/ggml-small.en.bin" },
  ],

  downloadModel(): Promise<void> {
    return new Promise((resolve) => {
      let received = 0;
      const total = 147_964_211;
      const t = window.setInterval(() => {
        received = Math.min(total, received + total / 12);
        const done = received >= total;
        emit("model-download", { id: "base.en", received, total, state: done ? "done" : "downloading", error: null });
        if (done) {
          window.clearInterval(t);
          modelInstalled = true;
          resolve();
        }
      }, 200);
    });
  },

  deleteModel() {
    modelInstalled = false;
  },

  transcriptStatus(itemId: number): TranscriptStatus {
    const item = items.find((i) => i.id === itemId);
    const t = transcripts.get(itemId);
    return {
      itemId,
      title: item?.title ?? "",
      state: t?.state ?? "none",
      doneMs: t?.doneMs ?? 0,
      durationMs: item?.durationS ? item.durationS * 1000 : null,
      sentences: t?.sentences.length ?? 0,
      error: null,
    };
  },

  sentences: (itemId: number): Sentence[] => transcripts.get(itemId)?.sentences ?? [],

  async transcribe(itemId: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item || transcripts.get(itemId)?.state === "running") return;
    const duration = (item.durationS ?? 300) * 1000;
    const t = { state: "queued" as TranscriptStatus["state"], sentences: [] as Sentence[], doneMs: 0 };
    transcripts.set(itemId, t);
    const update = () => {
      item.transcriptState = t.state;
      item.transcriptDoneMs = t.doneMs;
      emit("transcript", sample.transcriptStatus(itemId));
    };
    update();
    if (!modelInstalled) {
      t.state = "model";
      update();
      await sample.downloadModel();
    }
    t.state = "running";
    update();
    const timer = window.setInterval(() => {
      t.doneMs = Math.min(duration, t.doneMs + (t.doneMs === 0 ? 30_000 : 90_000));
      t.sentences = makeSentences(duration, t.doneMs);
      if (t.doneMs >= duration) {
        t.state = "done";
        window.clearInterval(timer);
      }
      update();
    }, 700);
  },

  startDictation(itemId: number, again: boolean): Session {
    let a = attempts.find((x) => x.itemId === itemId && x.finishedAt === null);
    if (a && again) a.finishedAt = now();
    if (!a || again) {
      a = { id: attempts.length + 1, itemId, startedAt: now(), updatedAt: now(), finishedAt: null, position: 0, seconds: 0 };
      attempts.push(a);
      answers.set(a.id, new Map());
    }
    emit("practice", null);
    return sample.session(a.id);
  },

  session(attemptId: number): Session {
    const a = attemptById(attemptId);
    return { attempt: { ...a }, answers: [...(answers.get(a.id)?.values() ?? [])].sort((x, y) => x.idx - y.idx), flagged: flaggedOf(a.id) };
  },

  // Word practice, with fixed intervals instead of FSRS.
  progress(): Progress {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86_400_000);
    const from = new Date(monday.getTime() - 52 * 7 * 86_400_000);
    // A made-up year that starts slowly and gets more regular.
    const days: DayDetail[] = [];
    for (let t = from.getTime(), i = 0; t <= today.getTime(); t += 86_400_000, i++) {
      const r = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      if (r < 0.75 - (i / 371) * 0.45) continue;
      const minutes = Math.round(5 + r * 55);
      days.push({ day: iso(new Date(t)), seconds: minutes * 60, sentences: Math.round(minutes * 1.6), episodes: 1 + Math.floor(r * 2), words: Math.floor(r * 20) });
    }
    const weeks = Array.from({ length: 12 }, (_, i) => ({
      start: iso(new Date(monday.getTime() - (11 - i) * 7 * 86_400_000)),
      accuracy: 0.62 + i * 0.016 + (i % 3 === 1 ? -0.02 : 0),
      sentences: 80 + i * 6,
    }));
    const recent = days.filter((d) => d.day >= iso(new Date(today.getTime() - 6 * 86_400_000)));
    return {
      streak: 4,
      bestStreak: 19,
      weekSeconds: recent.reduce((n, d) => n + d.seconds, 0),
      monthAccuracy: 0.79,
      lastMonthAccuracy: 0.73,
      wordsKnown: savedWords.filter((w) => w.level === "known").length,
      wordsTotal: savedWords.length,
      from: iso(from),
      yearSeconds: days.reduce((n, d) => n + d.seconds, 0),
      days,
      weeks,
    };
  },
  week(): Week {
    const minutes = [20, 40, 0, 50, 30, 15, 25];
    const days = minutes.map((m, i) => {
      const d = new Date(Date.now() - (6 - i) * 86_400_000);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { day, seconds: m * 60 };
    });
    return { days, streak: 4, wordsStarted: 5 };
  },
  practiceCounts(): PracticeCounts {
    const t = now();
    const due = savedWords.filter((w) => w.level !== "new" && (w.dueAt ?? 0) <= t).length;
    const fresh = Math.min(10, savedWords.filter((w) => w.level === "new").length);
    return { due, new: fresh, total: due + fresh };
  },
  practiceQueue(): PracticeItem[] {
    const t = now();
    const due = savedWords.filter((w) => w.level !== "new" && (w.dueAt ?? 0) <= t).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    const fresh = savedWords.filter((w) => w.level === "new").sort((a, b) => a.addedAt - b.addedAt);
    const answerOf = (w: SavedWord) => w.note || w.meaning.split("\n")[0];
    return [...due, ...fresh].slice(0, 20).map((w) => {
      const c = w.contexts[0];
      const i = c.sentence.toLowerCase().indexOf(w.text.toLowerCase());
      const others = [...new Set(savedWords.filter((o) => o.id !== w.id).map(answerOf))].sort(() => Math.random() - 0.5).slice(0, 3);
      return {
        word: { ...w },
        context: c,
        gap: i >= 0 ? [c.sentence.slice(0, i), c.sentence.slice(i, i + w.text.length), c.sentence.slice(i + w.text.length)] : null,
        answer: answerOf(w),
        choices: others.length === 3 ? [...others, answerOf(w)].sort(() => Math.random() - 0.5) : [],
        next: NEXT,
      };
    });
  },
  practiceCheck(expected: string, typed: string): boolean {
    const e = looseWords(expected);
    return e.length > 0 && e.join(" ") === looseWords(typed).join(" ");
  },
  practiceGrade(a: GradeArgs): Graded {
    const w = savedWords.find((x) => x.id === a.wordId)!;
    w.level = (["learning", "learning", "familiar", "known"] as Level[])[a.grade - 1];
    w.dueAt = now() + NEXT[a.grade - 1];
    w.reviews += 1;
    emit("words", null);
    return { level: w.level, dueAt: w.dueAt };
  },
  practiceKnow(id: number): Graded {
    const w = savedWords.find((x) => x.id === id)!;
    w.level = "known";
    w.dueAt = now() + 365 * 86_400;
    emit("words", null);
    return { level: w.level, dueAt: w.dueAt };
  },

  // Settings › Dictionaries and Storage.
  async dictionaries(): Promise<DictionaryList> {
    await wait(300);
    return { dictionaries: SAMPLE_DICTS.map((d) => ({ ...d, ...installedDicts.get(d.lang) })), offline: false };
  },
  async updateDictionary(lang: string) {
    await wait(1200);
    const d = SAMPLE_DICTS.find((x) => x.lang === lang)!;
    installedDicts.set(lang, { installedVersion: d.latestVersion, installedBytes: d.downloadBytes * 3 });
  },
  async removeDictionary(lang: string) {
    installedDicts.delete(lang);
  },
  storage(): StorageUsage {
    return {
      dataDir: "~/Library/Application Support/com.eksigo.desktop",
      episodes: 6,
      episodesBytes: 412e6,
      ownFiles: 2,
      ownFilesBytes: 96e6,
      modelsBytes: 148e6,
      dictionariesBytes: [...installedDicts.values()].reduce((n, d) => n + (d.installedBytes ?? 0), 0),
      databaseBytes: 3.4e6,
    };
  },

  // A few words, so the look-up card has something to show in a browser.
  lookup(text: string): Lookup {
    const words = text.toLowerCase().replace(/[^a-z' \-]/g, " ").split(/\s+/).filter(Boolean);
    const query = words.join(" ");
    const get = (w: string) => {
      const base = SAMPLE_FORMS[w] ?? w;
      const m = SAMPLE_DICT[base];
      return m ? { headword: base, ipa: m[0], meaning: m[1], definition: m[2] } : null;
    };
    if (words.length === 1) {
      const e = get(words[0]);
      return { query, entry: e, whole: !!e, words: [], source: "ECDICT" };
    }
    let entry = get(query);
    const whole = !!entry;
    for (let len = words.length - 1; !entry && len >= 2; len--)
      for (let i = 0; !entry && i + len <= words.length; i++) entry = get(words.slice(i, i + len).join(" "));
    return { query, entry, whole, words: words.map((w) => ({ text: w, entry: get(w) })), source: "ECDICT" };
  },

  wordTimes(itemId: number, idx: number): [number, number][] {
    const s = transcripts.get(itemId)?.sentences[idx];
    if (!s) return [];
    const n = s.text.split(/\s+/).filter(Boolean).length;
    const step = (s.endMs - s.startMs) / Math.max(1, n);
    return Array.from({ length: n }, (_, i) => [Math.round(s.startMs + i * step), Math.round(s.startMs + (i + 1) * step)]);
  },

  addWord(w: NewWord): SavedWord {
    let saved = savedWords.find((x) => x.text.toLowerCase() === w.text.trim().toLowerCase());
    if (!saved) {
      saved = {
        id: Math.max(0, ...savedWords.map((x) => x.id)) + 1,
        text: w.text.trim(),
        headword: w.headword,
        ipa: w.ipa,
        meaning: w.meaning,
        note: w.note.trim(),
        addedAt: now(),
        level: "new",
        dueAt: null,
        reviews: 0,
        contexts: [],
      };
      savedWords.unshift(saved);
    } else if (!saved.note) saved.note = w.note.trim();
    const item = items.find((i) => i.id === w.itemId);
    const s = transcripts.get(w.itemId)?.sentences[w.idx];
    const times = sample.wordTimes(w.itemId, w.idx);
    if (s && !saved.contexts.some((c) => c.itemId === w.itemId && c.idx === w.idx))
      saved.contexts.unshift({
        itemId: w.itemId,
        itemTitle: item?.title ?? null,
        path: item?.path ?? null,
        idx: w.idx,
        sentence: s.text,
        typed: w.typed,
        startMs: times[w.from]?.[0] ?? s.startMs,
        endMs: times[w.to]?.[1] ?? s.endMs,
        sentenceStartMs: s.startMs,
        sentenceEndMs: s.endMs,
        addedAt: now(),
      });
    emit("words", null);
    return { ...saved };
  },
  words: (): SavedWord[] => savedWords.map((w) => ({ ...w })),
  wordSaved: (text: string): number | null => savedWords.find((x) => x.text.toLowerCase() === text.trim().toLowerCase())?.id ?? null,
  setWordNote(id: number, note: string) {
    const w = savedWords.find((x) => x.id === id);
    if (w) w.note = note.trim();
    emit("words", null);
  },
  removeWord(id: number) {
    const i = savedWords.findIndex((x) => x.id === id);
    if (i >= 0) savedWords.splice(i, 1);
    emit("words", null);
  },

  flag(attemptId: number, idx: number, on: boolean) {
    if (!flags.has(attemptId)) flags.set(attemptId, new Set());
    if (on) flags.get(attemptId)!.add(idx);
    else flags.get(attemptId)!.delete(idx);
    emit("practice", null);
  },

  answer(attemptId: number, idx: number, kind: AnswerKind, typed: string, plays: number, seconds: number): Answer {
    const a = attemptById(attemptId);
    const original = transcripts.get(a.itemId)?.sentences[idx]?.text;
    if (original === undefined) throw new Error(`Sentence ${idx + 1} isn't transcribed yet.`);
    const comparison = kind === "typed" ? roughCompare(original, typed) : kind === "known" ? { ...roughCompare(original, original), typed: [] } : null;
    const ans: Answer = {
      idx,
      kind,
      original,
      typed: kind === "typed" ? typed.trim() : "",
      plays,
      credit: comparison?.credit ?? 0,
      total: comparison?.total ?? 0,
      spelling: 0,
      comparison,
    };
    answers.get(a.id)!.set(idx, ans);
    sample.savePosition(attemptId, idx + 1, seconds);
    return ans;
  },

  markAds(attemptId: number, from: number, to: number, seconds: number) {
    for (let i = from; i < to; i++) sample.answer(attemptId, i, "ad", "", 0, 0);
    sample.savePosition(attemptId, to, seconds);
  },

  savePosition(attemptId: number, position: number, seconds: number) {
    const a = attemptById(attemptId);
    a.position = position;
    a.seconds += Math.min(180, Math.max(0, seconds));
    a.updatedAt = now();
    const item = items.find((i) => i.id === a.itemId);
    if (item) item.lastPractisedAt = now();
    emit("practice", null);
  },

  finishDictation(attemptId: number): Summary {
    const a = attemptById(attemptId);
    a.finishedAt ??= now();
    emit("practice", null);
    return summaryOf(a);
  },

  summary: (attemptId: number): Summary => summaryOf(attemptById(attemptId)),
  attempts: (itemId: number): Summary[] => attempts.filter((a) => a.itemId === itemId).reverse().map(summaryOf),
  inProgress: (): InProgress[] =>
    attempts
      .filter((a) => a.finishedAt === null)
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .map((a) => {
        const item = items.find((i) => i.id === a.itemId);
        const s = summaryOf(a);
        return {
          itemId: a.itemId,
          attemptId: a.id,
          title: item?.title ?? "",
          source: item?.source ?? "",
          artworkUrl: item?.artworkUrl ?? null,
          position: a.position,
          done: s.done,
          sentences: s.sentences,
          transcriptDone: s.transcriptDone,
          updatedAt: a.updatedAt,
        };
      }),

  play(args: { id: number; startMs: number; endMs: number | null; speed: number }) {
    sample.stop();
    let pos = args.startMs;
    const end = args.endMs ?? args.startMs + 5 * 60_000;
    emit("playback", { id: args.id, playing: true, positionMs: pos, error: null } satisfies PlaybackEvent);
    playTimer = window.setInterval(() => {
      pos += 100 * args.speed;
      const done = pos >= end;
      emit("playback", { id: args.id, playing: !done, positionMs: Math.min(pos, end), error: null } satisfies PlaybackEvent);
      if (done) sample.stop();
    }, 100);
  },

  stop() {
    if (playTimer !== null) window.clearInterval(playTimer);
    playTimer = null;
  },

  on(event: string, handler: (p: unknown) => void): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
    return () => listeners.get(event)?.delete(handler);
  },
};
