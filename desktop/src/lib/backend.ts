// The one place the interface talks to the Rust core. In a plain browser (the preview pane, `npm run dev`)
// there is no Rust side, so each call falls back to sample data (sample.ts) and the screens still work.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { sample } from "./sample";

export const inApp = isTauri();

export type AppInfo = {
  version: string;
  os: string; // "macos" | "windows" | "linux" | "browser"
  dataDir: string;
  schemaVersion: number;
  whisperBackend: string; // "Metal" | "CPU" | "—"
};

export type TranscriptState = "none" | "queued" | "model" | "running" | "done" | "failed";

export type TranscriptStatus = {
  itemId: number;
  title: string;
  state: TranscriptState;
  doneMs: number;
  durationMs: number | null;
  sentences: number;
  error: string | null;
};

export type Sentence = { idx: number; startMs: number; endMs: number; text: string };

export type ModelInfo = { id: string; name: string; bytes: number; installed: boolean; available: boolean; path: string };
export type ModelProgress = { id: string; received: number; total: number; state: "downloading" | "done" | "failed" | "cancelled"; error: string | null };

/** A show in search results, charts or recommendations. */
export type Listing = {
  appleId: string | null;
  title: string;
  author: string;
  feedUrl: string | null;
  artworkUrl: string | null;
  note: string | null;
};

export type Show = {
  id: number;
  feedUrl: string;
  appleId: string | null;
  title: string;
  author: string;
  description: string;
  artworkUrl: string | null;
  subscribed: boolean;
  refreshedAt: number | null;
  episodeCount: number;
  newCount: number;
};

export type Episode = {
  id: number;
  showId: number;
  title: string;
  publishedAt: number | null; // Unix seconds
  durationS: number | null;
  audioUrl: string;
  audioBytes: number | null;
  description: string;
  artworkUrl: string | null;
  itemId: number | null;
  itemState: ItemState | null;
  practice?: Practice | null;
};

export type ItemState = "downloading" | "ready" | "failed" | "missing";

export type Item = {
  id: number;
  episodeId: number | null;
  showId: number | null;
  title: string;
  source: string;
  ownFile: boolean;
  path: string | null;
  bytes: number | null;
  durationS: number | null;
  state: ItemState;
  error: string | null;
  addedAt: number;
  lastPractisedAt: number | null;
  artworkUrl: string | null;
  transcriptState: TranscriptState;
  transcriptDoneMs: number;
  practice?: Practice | null;
};

// ---------- dictation ----------

export type Mark = "correct" | "spelling" | "wrong" | "missing" | "extra" | "gap" | "ignored";
export type Marked = { text: string; mark: Mark };
export type Comparison = { original: Marked[]; typed: Marked[]; credit: number; total: number; spelling: number };

export type Attempt = {
  id: number;
  itemId: number;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** The sentence to carry on from. */
  position: number;
  seconds: number;
};

export type AnswerKind = "typed" | "known" | "ad";
export type Answer = {
  idx: number;
  kind: AnswerKind;
  original: string;
  typed: string;
  plays: number;
  credit: number;
  total: number;
  spelling: number;
  comparison: Comparison | null;
};

/** An attempt, its answers, and the sentences flagged for the review. */
export type Session = { attempt: Attempt; answers: Answer[]; flagged: number[] };

export type Summary = {
  attempt: Attempt;
  done: number;
  known: number;
  withMistakes: number;
  ads: number;
  /** Sentences flagged for the review. */
  flagged: number;
  credit: number;
  total: number;
  spelling: number;
  accuracy: number | null;
  sentences: number;
  transcriptDone: boolean;
};

// ---------- dictionary and My words ----------

export type Entry = { headword: string; ipa: string; meaning: string; definition: string };
export type WordLine = { text: string; entry: Entry | null };
/** A selection looked up: the whole phrase, or the longest phrase inside it, and each word on its own. */
export type Lookup = { query: string; entry: Entry | null; whole: boolean; words: WordLine[]; source: string };

/** One language's dictionary: what the server offers and what's on this computer (Settings › Dictionaries). */
export type DictInfo = {
  lang: string;
  source: string;
  /** Packed download size; 0 when the server couldn't be asked. */
  downloadBytes: number;
  latestVersion: number | null;
  installedVersion: number | null;
  installedBytes: number;
};
export type DictionaryList = { dictionaries: DictInfo[]; offline: boolean };

/** What Eksigo keeps on this computer (Settings › Storage). */
export type StorageUsage = {
  dataDir: string;
  episodes: number;
  episodesBytes: number;
  ownFiles: number;
  ownFilesBytes: number;
  modelsBytes: number;
  dictionariesBytes: number;
  databaseBytes: number;
};

export type WordContext = {
  itemId: number | null;
  itemTitle: string | null;
  path: string | null;
  idx: number;
  sentence: string;
  typed: string;
  /** The saved words in the audio. */
  startMs: number;
  endMs: number;
  /** The whole sentence in the audio. */
  sentenceStartMs: number;
  sentenceEndMs: number;
  addedAt: number;
};
export type SavedWord = { id: number; text: string; headword: string; ipa: string; meaning: string; note: string; addedAt: number; contexts: WordContext[] };
export type NewWord = {
  text: string;
  headword: string;
  ipa: string;
  meaning: string;
  note: string;
  itemId: number;
  idx: number;
  /** The selected written words of the sentence, from..=to. */
  from: number;
  to: number;
  typed: string;
};

/** The latest dictation of an item, for the Practice column. */
export type Practice = {
  attemptId: number;
  position: number;
  /** Sentences answered (typed or known). */
  done: number;
  sentences: number;
  transcriptDone: boolean;
  finished: boolean;
  accuracy: number | null;
};

export type InProgress = {
  itemId: number;
  attemptId: number;
  title: string;
  source: string;
  artworkUrl: string | null;
  position: number;
  done: number;
  sentences: number;
  transcriptDone: boolean;
  updatedAt: number;
};

export type ShowPage = { show: Show; episodes: Episode[] };
export type EpisodePage = { episode: Episode; show: Show; item: Item | null };
export type LibraryPage = { items: Item[]; downloadsBytes: number };
export type Added = { ids: number[]; skipped: [path: string, reason: string][] };

export type DownloadProgress = { itemId: number; received: number; total: number | null };
export type PlaybackEvent = { id: number; playing: boolean; positionMs: number; error: string | null };

export const AUDIO_EXTENSIONS = ["mp3", "m4a", "mp4", "m4v", "mov", "aac", "wav", "flac", "ogg", "oga"];

const browserOs = () => (navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Windows") ? "windows" : "linux");

function localGet(key: string): string | null {
  try {
    return localStorage.getItem(`eksigo.${key}`);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string) {
  try {
    localStorage.setItem(`eksigo.${key}`, value);
  } catch {
    /* storage can be unavailable in private windows; settings then last for this visit only */
  }
}

/** Calls the Rust command in the app, or the sample stand-in in a browser. */
function call<T>(command: string, args: Record<string, unknown>, fallback: () => T | Promise<T>): Promise<T> {
  if (inApp) return invoke<T>(command, args);
  return Promise.resolve().then(fallback);
}

export const backend = {
  appInfo: () =>
    call<AppInfo>("app_info", {}, () => ({ version: "0.1.0", os: browserOs(), dataDir: "(browser preview)", schemaVersion: 0, whisperBackend: "—" })),

  getSetting: async (key: string) => (await call<string | null>("get_setting", { key }, () => localGet(key))) ?? null,
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }, () => localSet(key, value)),

  // Speech models and transcripts
  models: () => call<ModelInfo[]>("models_list", {}, () => sample.models()),
  downloadModel: () => call<void>("model_download", {}, () => sample.downloadModel()),
  cancelModel: () => call<void>("model_cancel", {}, () => undefined),
  deleteModel: (id: string) => call<void>("model_delete", { id }, () => sample.deleteModel()),
  transcribe: (itemId: number) => call<void>("transcribe", { itemId }, () => sample.transcribe(itemId)),
  cancelTranscript: (itemId: number) => call<void>("transcribe_cancel", { itemId }, () => undefined),
  transcriptStatus: (itemId: number) => call<TranscriptStatus>("transcript_status", { itemId }, () => sample.transcriptStatus(itemId)),
  sentences: (itemId: number) => call<Sentence[]>("transcript_sentences", { itemId }, () => sample.sentences(itemId)),

  // Podcasts
  forLearners: () => call<Listing[]>("podcasts_for_learners", {}, () => sample.learners),
  search: (term: string, country: string) => call<Listing[]>("podcasts_search", { term, country }, () => sample.search(term)),
  chart: (country: string, genre: number | null) => call<Listing[]>("podcasts_chart", { country, genre }, () => sample.chart(genre)),
  openListing: (listing: Listing) => call<number>("show_open", { listing }, () => sample.openListing(listing)),
  addFeed: (url: string) => call<number>("show_add_feed", { url }, () => sample.addFeed(url)),
  getShow: (id: number) => call<ShowPage>("show_get", { id }, () => sample.showPage(id)),
  refreshShow: (id: number) => call<ShowPage>("show_refresh", { id }, () => sample.showPage(id)),
  subscribe: (id: number, on: boolean) => call<void>("show_subscribe", { id, on }, () => sample.subscribe(id, on)),
  subscribed: () => call<Show[]>("shows_subscribed", {}, () => sample.subscribed()),
  getEpisode: (id: number) => call<EpisodePage>("episode_get", { id }, () => sample.episodePage(id)),
  download: (id: number) => call<number>("episode_download", { id }, () => sample.download(id)),
  cancelDownload: (itemId: number) => call<boolean>("download_cancel", { itemId }, () => sample.cancel(itemId)),

  // The Library
  library: () => call<LibraryPage>("library_items", {}, () => sample.library()),
  item: (id: number) => call<Item>("library_item", { id }, () => sample.item(id)),
  addFiles: (paths: string[]) => call<Added>("library_add_files", { paths }, () => ({ ids: [], skipped: [] })),
  remove: (id: number) => call<void>("library_remove", { id }, () => sample.remove(id)),

  // Dictation
  startDictation: (itemId: number, again = false) => call<Session>("dictation_start", { itemId, again }, () => sample.startDictation(itemId, again)),
  answer: (attemptId: number, idx: number, kind: AnswerKind, typed: string, plays: number, seconds: number) =>
    call<Answer>("dictation_answer", { attemptId, idx, kind, typed, plays, seconds }, () => sample.answer(attemptId, idx, kind, typed, plays, seconds)),
  markAds: (attemptId: number, from: number, to: number, seconds: number) =>
    call<void>("dictation_mark_ads", { attemptId, from, to, seconds }, () => sample.markAds(attemptId, from, to, seconds)),
  savePosition: (attemptId: number, position: number, seconds: number) =>
    call<void>("dictation_position", { attemptId, position, seconds }, () => sample.savePosition(attemptId, position, seconds)),
  finishDictation: (attemptId: number) => call<Summary>("dictation_finish", { attemptId }, () => sample.finishDictation(attemptId)),
  session: (attemptId: number) => call<Session>("dictation_session", { attemptId }, () => sample.session(attemptId)),
  flag: (attemptId: number, idx: number, on: boolean) => call<void>("dictation_flag", { attemptId, idx, on }, () => sample.flag(attemptId, idx, on)),
  summary: (attemptId: number) => call<Summary>("dictation_summary", { attemptId }, () => sample.summary(attemptId)),
  attempts: (itemId: number) => call<Summary[]>("dictation_attempts", { itemId }, () => sample.attempts(itemId)),
  inProgress: () => call<InProgress[]>("dictation_in_progress", {}, () => sample.inProgress()),

  // Dictionary and My words
  lookup: (lang: string, text: string) => call<Lookup>("dictionary_lookup", { lang, text }, () => sample.lookup(text)),
  wordTimes: (itemId: number, idx: number) => call<[number, number][]>("sentence_word_times", { itemId, idx }, () => sample.wordTimes(itemId, idx)),
  addWord: (word: NewWord) => call<SavedWord>("words_add", { word }, () => sample.addWord(word)),
  words: () => call<SavedWord[]>("words_list", {}, () => sample.words()),
  wordSaved: (text: string) => call<number | null>("words_saved", { text }, () => sample.wordSaved(text)),
  setWordNote: (id: number, note: string) => call<void>("words_note", { id, note }, () => sample.setWordNote(id, note)),
  removeWord: (id: number) => call<void>("words_remove", { id }, () => sample.removeWord(id)),
  dictionaries: () => call<DictionaryList>("dictionary_list", {}, () => sample.dictionaries()),
  updateDictionary: (lang: string) => call<void>("dictionary_update", { lang }, () => sample.updateDictionary(lang)),
  removeDictionary: (lang: string) => call<void>("dictionary_remove", { lang }, () => sample.removeDictionary(lang)),

  // Storage
  storage: () => call<StorageUsage>("storage_usage", {}, () => sample.storage()),
  /** Opens a web page in the default browser. */
  async openUrl(url: string) {
    if (inApp) await openUrl(url);
    else window.open(url, "_blank", "noopener");
  },
  /** Shows a file or folder in Finder or File Explorer. */
  async reveal(path: string) {
    if (inApp) await revealItemInDir(path);
  },

  // Playback
  play: (args: { id: number; path: string; startMs: number; endMs: number | null; speed: number }) =>
    call<void>("play", { args }, () => sample.play(args)),
  stopPlayback: () => call<void>("stop_playback", {}, () => sample.stop()),

  /** Opens the system file picker. Returns the chosen paths; empty when cancelled or in the browser. */
  async pickFiles(title: string, extensions: string[], multiple = false): Promise<string[]> {
    if (!inApp) return [];
    const picked = await open({ title, multiple, directory: false, filters: [{ name: title, extensions }] });
    if (picked === null) return [];
    return Array.isArray(picked) ? picked : [picked];
  },

};

type Events = {
  download: DownloadProgress;
  library: null;
  practice: null;
  words: null;
  playback: PlaybackEvent;
  transcript: TranscriptStatus;
  "model-download": ModelProgress;
};

/** Listens to an event from the Rust core (sample.ts plays them in a browser). Returns the unlisten function. */
export function on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
  if (!inApp) return sample.on(event, handler as (p: unknown) => void);
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  listen<Events[K]>(event, (e) => handler(e.payload)).then((u) => {
    if (cancelled) u();
    else unlisten = u;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Listens to files dropped on the window (the app only). */
export function onFileDrop(handlers: { over: (on: boolean) => void; drop: (paths: string[]) => void }): () => void {
  if (!inApp) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  getCurrentWebview()
    .onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") handlers.over(true);
      else if (p.type === "leave") handlers.over(false);
      else if (p.type === "drop") {
        handlers.over(false);
        handlers.drop(p.paths);
      }
    })
    .then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Cover art through api.eksigo.com, which scales it down and can reach hosts some countries block. */
export function artUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("data:") || url.startsWith("/")) return url;
  return `https://api.eksigo.com/v1/art?url=${encodeURIComponent(url)}`;
}
