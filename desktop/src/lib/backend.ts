// The one place the interface talks to the Rust core. In a plain browser (the preview pane, `npm run dev`)
// there is no Rust side, so each call falls back to sample data and the screens still work.

import { invoke, isTauri } from "@tauri-apps/api/core";

export const inApp = isTauri();

export type AppInfo = {
  version: string;
  os: string; // "macos" | "windows" | "linux" | "browser"
  dataDir: string;
  schemaVersion: number;
  whisperBackend: string; // "Metal" | "CPU" | "—"
};

export type Segment = { startMs: number; endMs: number; text: string };

export type BenchReport = {
  audioSeconds: number;
  decodeMs: number;
  loadModelMs: number;
  transcribeMs: number;
  speed: number;
  backend: string;
  threads: number;
  segments: Segment[];
};

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

export const backend = {
  appInfo(): Promise<AppInfo> {
    if (inApp) return invoke("app_info");
    return Promise.resolve({ version: "0.1.0", os: browserOs(), dataDir: "(browser preview)", schemaVersion: 0, whisperBackend: "—" });
  },

  async getSetting(key: string): Promise<string | null> {
    if (inApp) return (await invoke<string | null>("get_setting", { key })) ?? null;
    return localGet(key);
  },

  async setSetting(key: string, value: string): Promise<void> {
    if (inApp) return invoke("set_setting", { key, value });
    localSet(key, value);
  },

  whisperBench(modelPath: string, audioPath: string): Promise<BenchReport> {
    if (inApp) return invoke("whisper_bench", { modelPath, audioPath });
    return Promise.reject(new Error("Transcription only runs in the app, not in the browser preview."));
  },

  /** Opens the system file picker. Returns null when cancelled or in the browser. */
  async pickFile(title: string, extensions: string[]): Promise<string | null> {
    if (!inApp) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ title, multiple: false, directory: false, filters: [{ name: title, extensions }] });
    return typeof picked === "string" ? picked : null;
  },
};
