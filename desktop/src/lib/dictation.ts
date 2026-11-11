// Dictation settings (saved as defaults, changeable during a session) and the unfinished episodes list.

import { useCallback, useEffect, useState } from "react";
import { backend, on, type InProgress, type Practice } from "./backend";

export type DictationSettings = {
  /** Manual: each sentence plays when asked (Tab). Auto: it plays `maxPlays` times in a row. */
  mode: "manual" | "auto";
  speed: number;
  maxPlays: number;
  /** Auto mode: a fixed pause, or one as long as the sentence times `pauseFactor`. */
  pauseKind: "fixed" | "relative";
  pauseSeconds: number;
  pauseFactor: number;
  /** Show the original after each sentence, or only when stopping or finishing. */
  showOriginal: "end" | "each";
  /** Mod R plays the sentence once at this speed. */
  slowSpeed: number;
};

export const DEFAULTS: DictationSettings = {
  mode: "manual",
  speed: 1,
  maxPlays: 3,
  pauseKind: "relative",
  pauseSeconds: 3,
  pauseFactor: 1.5,
  showOriginal: "end",
  slowSpeed: 0.75,
};

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1.5;
export const SPEED_STEP = 0.05;
export const PLAYS_MAX = 5;
export const PAUSE_FACTORS = [1, 1.5, 2] as const;

/** Rounded to the 0.05 grid and kept within 0.5–1.5. */
export function clampSpeed(s: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(s / SPEED_STEP) * SPEED_STEP));
}

/** "0.85×", "1.0×". */
export function speedLabel(s: number): string {
  const r = Math.round(s * 100) / 100;
  return `${Number.isInteger(r) ? r.toFixed(1) : r}×`;
}

/** Mod R's speed: the slow speed, or 0.15 below the current one when that is already slow. */
export function slowerSpeed(current: number, slow: number): number {
  return current > slow + 0.001 ? slow : clampSpeed(current - 0.15);
}

/** The pause before an automatic replay, in ms. */
export function pauseMs(s: DictationSettings, sentenceMs: number, speed: number): number {
  return s.pauseKind === "fixed" ? s.pauseSeconds * 1000 : (s.pauseFactor * sentenceMs) / speed;
}

const KEY = "dictation";

function parse(raw: string | null): DictationSettings {
  try {
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULTS;
  }
}

let cache: DictationSettings | null = null;
const subscribers = new Set<(s: DictationSettings) => void>();

/** The dictation settings; changes are saved as the defaults at once. */
export function useDictationSettings(): [DictationSettings, (change: Partial<DictationSettings>) => void, boolean] {
  const [settings, setSettings] = useState<DictationSettings>(cache ?? DEFAULTS);
  const [loaded, setLoaded] = useState(cache !== null);
  useEffect(() => {
    subscribers.add(setSettings);
    if (!cache)
      backend.getSetting(KEY).then((raw) => {
        cache = parse(raw);
        subscribers.forEach((f) => f(cache!));
        setLoaded(true);
      });
    return () => {
      subscribers.delete(setSettings);
    };
  }, []);
  const update = useCallback((change: Partial<DictationSettings>) => {
    cache = { ...(cache ?? DEFAULTS), ...change };
    cache.speed = clampSpeed(cache.speed);
    subscribers.forEach((f) => f(cache!));
    backend.setSetting(KEY, JSON.stringify(cache));
  }, []);
  return [settings, update, loaded];
}

/** Unfinished episodes, newest first; refreshed when practice changes anywhere. */
export function useInProgress(): InProgress[] {
  const [list, setList] = useState<InProgress[]>([]);
  useEffect(() => {
    const load = () => backend.inProgress().then(setList, () => {});
    load();
    const off1 = on("practice", load);
    const off2 = on("library", load);
    return () => {
      off1();
      off2();
    };
  }, []);
  return list;
}

/** Sentences done: "31/100", or "31" while the transcript is still growing. */
export function progressLabel(p: Pick<Practice, "done" | "sentences" | "transcriptDone">): string {
  if (p.transcriptDone && p.sentences) return `${p.done}/${p.sentences}`;
  return p.done ? `${p.done}` : "";
}

/** "92%". */
export function percent(f: number | null | undefined): string {
  return f == null ? "—" : `${Math.round(f * 100)}%`;
}

export const dictationPath = (itemId: number) => `/library/${itemId}/dictation`;
