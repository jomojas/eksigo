// The language word meanings are shown in, My words, and reading words aloud.

import { useCallback, useEffect, useState } from "react";
import { backend, on, type Level, type PracticeCounts, type SavedWord } from "./backend";

/** The offline dictionaries the server has (backend/app/dictionaries), by the language meanings are in. */
export const MEANING_LANGUAGES: [string, string][] = [
  ["zh", "中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["es", "Español"],
  ["fr", "Français"],
  ["en", "English"],
];

const KEY = "meanings";

/** The computer's language, when there's a dictionary for it; English definitions otherwise. */
export function systemLanguage(): string {
  const code = (navigator.language || "en").toLowerCase().split("-")[0];
  return MEANING_LANGUAGES.some(([c]) => c === code) ? code : "en";
}

let cache: string | null = null;
const subscribers = new Set<(l: string) => void>();

export function useMeaningLanguage(): [string, (l: string) => void] {
  const [lang, setLang] = useState(cache ?? systemLanguage());
  useEffect(() => {
    subscribers.add(setLang);
    if (cache === null)
      backend.getSetting(KEY).then((v) => {
        cache = v || systemLanguage();
        subscribers.forEach((f) => f(cache!));
      });
    return () => {
      subscribers.delete(setLang);
    };
  }, []);
  const set = useCallback((l: string) => {
    cache = l;
    subscribers.forEach((f) => f(l));
    backend.setSetting(KEY, l);
  }, []);
  return [lang, set];
}

/** My words, refreshed when one is added, changed or removed anywhere. */
export function useWords(): [SavedWord[], boolean] {
  const [list, setList] = useState<SavedWord[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const load = () =>
      backend.words().then((w) => {
        setList(w);
        setLoaded(true);
      });
    load();
    return on("words", load);
  }, []);
  return [list, loaded];
}

/** The most natural English voice on this computer: the downloadable "Premium" / "Enhanced" / "Natural"
 * voices first (macOS System Settings › Accessibility › Spoken Content; Windows 11 natural voices). */
function bestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 40 : /enhanced|natural|neural/i.test(v.name) ? 30 : /siri/i.test(v.name) ? 20 : 0) +
    (/en[-_](us|gb)/i.test(v.lang) ? 5 : 0) +
    (v.localService ? 2 : 0);
  return english.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** Reads English aloud with the computer's own voice, slowly; nothing is sent anywhere. */
export function speak(text: string, rate = 0.75) {
  const synth = window.speechSynthesis;
  if (!synth) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate;
  const voice = bestVoice(synth.getVoices());
  if (voice) u.voice = voice;
  synth.speak(u);
  return true;
}

/** The first line of a meaning, for lists. */
export const firstLine = (s: string) => s.split("\n")[0] ?? "";

export const LEVELS: [Level, string][] = [
  ["new", "New"],
  ["learning", "Learning"],
  ["familiar", "Familiar"],
  ["known", "Known"],
];
export const levelName = (l: Level) => LEVELS.find(([x]) => x === l)?.[1] ?? l;

/** Words to practise today (due, and new ones up to 10 a day), kept current. */
export function usePracticeCounts(): PracticeCounts | null {
  const [counts, setCounts] = useState<PracticeCounts | null>(null);
  useEffect(() => {
    const load = () => backend.practiceCounts().then(setCounts, () => {});
    load();
    // The day can change while the app is open.
    const timer = window.setInterval(load, 5 * 60_000);
    const off = on("words", load);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);
  return counts;
}
