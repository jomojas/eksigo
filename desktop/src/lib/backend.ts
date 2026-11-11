// The one place the interface talks to the Rust core. In a plain browser (the preview pane, `npm run dev`)
// there is no Rust side, so each call falls back to sample data (sample.ts) and the screens still work.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
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
