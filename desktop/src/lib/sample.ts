// Stand-ins for the Rust core in a plain browser (`npm run dev`, the preview pane): a few shows, episodes
// and Library items kept in memory, with downloads and playback simulated by timers. Never used in the app.

import type { Added, EpisodePage, Episode, Item, LibraryPage, Listing, ModelInfo, PlaybackEvent, Sentence, Show, ShowPage, TranscriptStatus } from "./backend";
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
    return { show: { ...show }, episodes: episodes.filter((e) => e.showId === id).map((e) => ({ ...e, artworkUrl: e.artworkUrl ?? show.artworkUrl })) };
  },

  subscribe(id: number, on: boolean) {
    const show = shows.find((s) => s.id === id);
    if (show) show.subscribed = on;
  },

  subscribed: (): Show[] => shows.filter((s) => s.subscribed).map((s) => ({ ...s })),

  episodePage(id: number): EpisodePage {
    const episode = episodes.find((e) => e.id === id);
    if (!episode) throw notFound("episode");
    const show = shows.find((s) => s.id === episode.showId)!;
    const item = items.find((i) => i.id === episode.itemId) ?? null;
    return { episode: { ...episode, artworkUrl: episode.artworkUrl ?? show.artworkUrl }, show: { ...show }, item: item && { ...item } };
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
      .map((i) => ({ ...i })),
    downloadsBytes: items.filter((i) => !i.ownFile && i.state === "ready").reduce((n, i) => n + (i.bytes ?? 0), 0),
  }),

  item(id: number): Item {
    const item = items.find((i) => i.id === id);
    if (!item) throw notFound("item");
    return { ...item };
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
